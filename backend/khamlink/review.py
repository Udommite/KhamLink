"""Document review: the engine behind the suggestion rail.

Four categories, each derived from something the corpus actually knows rather than from a
language model's opinion:

- **correctness** — the token is in no entry of the dictionary at all.
- **clarity** — a near-synonym is materially commoner in the Thai National Corpus.
- **engagement** — the word is repeated, and the corpus offers near-synonyms for variety.
- **delivery** — the entry's own ``register`` field conflicts with the writer's stated
  formality. RID marks ปาก as colloquial, ถิ่น- as dialectal, โบ as archaic, แบบ as
  literary; those marks are the dictionary's judgement, not ours.

**PyThaiNLP decides where words begin and end; the dictionary only says what they mean.**
Segmenting with the headword trie instead looks tempting — it is already built for Context
Lens — but it is leftmost-longest over 51,762 written forms, so it happily cuts ซกมก into
ซก + มก and finds ลุ inside a misspelling. Boundaries first, lookup second.

Deliberately runs no model inference. Neighbours come from the stored index vectors and
lookups come from the alias table, so a review costs milliseconds and works on a server
that has never loaded BGE-M3.
"""

import math
import re
import threading

from .bge import frequency_table
from .domain import DomainError, normalize

# RID's own register marks. Dialect marks appear with both hyphen and en-dash forms, and
# some rows carry several marks separated by ';' or ',', so match on the stem of a part.
INFORMAL = ("ปาก", "แสลง", "ถิ่น")
ARCHAIC = ("โบ", "เลิก")
ELEVATED = ("แบบ", "ราชา", "กฎ", "กลอน")
REGISTER_NAMES = {
    "ปาก": "ภาษาปาก",
    "แสลง": "คำสแลง",
    "ถิ่น": "ภาษาถิ่น",
    "โบ": "คำโบราณ",
    "เลิก": "คำที่เลิกใช้แล้ว",
    "แบบ": "ภาษาแบบแผน",
    "ราชา": "ราชาศัพท์",
    "กฎ": "ศัพท์กฎหมาย",
    "กลอน": "ภาษากลอน",
}
FORMALITY_FLAGS = {
    "formal": INFORMAL + ARCHAIC,
    "neutral": ("แสลง",) + ARCHAIC,
    "casual": ELEVATED,
}
FORMALITY_MESSAGE = {
    "formal": "งานเขียนทางการมักเลี่ยงคำระดับนี้",
    "neutral": "คำระดับนี้อาจไม่เข้ากับงานเขียนทั่วไป",
    "casual": "คำระดับนี้อาจเป็นทางการเกินกว่าน้ำเสียงที่ตั้งไว้",
}

THAI = re.compile(r"[฀-๿]")
# RID prints a register mark inline as often as the ETL captured it into its own column:
# "(ปาก) ดีเยี่ยม", "(โบ) ขนหัว". Reading only the column misses most colloquial senses.
INLINE_MARK = re.compile(r"\((" + "|".join(sorted(REGISTER_NAMES, key=len, reverse=True)) + r")[^)]{0,12}\)")
# Senses repeat across editions, so requiring every sense to carry the mark silences words
# the dictionary really does mark; requiring a majority keeps ordinary words unflagged.
MARKED_SENSE_RATIO = 0.5
# A word this common in the Thai National Corpus is ordinary vocabulary, whatever one of
# its senses is marked. Measured separation on this corpus: the words that were being
# wrongly flagged sit at log10 3.5-5.6 (แพง, เพื่อน, บ้าน, ว่า) while the ones the
# dictionary really does mark sit at 1.9-2.6 (ตะกละ, เจ๊ง, แจ๋ว, เอื้อเฟื้อ).
COMMON_WORD_LOG = 3.0
# Variety suggestions need an unambiguous word. ผม is both น. (hair) and ส. (I), so its
# neighbours are hair words — useless, and visibly wrong, next to a pronoun.
CONTENT_POS = {"น.", "ก.", "ว."}
# Weights are the cost of leaving a suggestion unaddressed, not a confidence.
PENALTY = {"correctness": 4.0, "delivery": 3.0, "clarity": 2.0, "engagement": 1.0}
READING_WPM = 250
SPEAKING_WPM = 130
MIN_TOKEN = 2
REPEAT_THRESHOLD = 3
COMMONER_RATIO = 5.0
# Measured on this corpus: synonym pairs the dictionaries themselves declare average 0.854
# cosine against 0.452 for random pairs. Anything below the midpoint of that gap is not a
# substitute, it is merely topical — which is how "พจนานุกรม -> ได้แก่" got proposed.
NEIGHBOUR_FLOOR = 0.88
MAX_SUGGESTIONS = 120


def register_marks(register: str) -> list[str]:
    """The distinct marks in a RID register field, normalised to their stem."""
    marks = []
    for part in re.split(r"[;,]", (register or "").replace("–", "-")):
        stem = part.strip().split("-")[0].strip()
        if stem and stem not in marks:
            marks.append(stem)
    return marks


def sense_marks(sense: dict) -> list[str]:
    """Every register mark this sense carries, from its own field and from its text."""
    marks = register_marks(sense["metadata"].get("register") or "")
    for found in INLINE_MARK.findall(sense.get("text") or ""):
        if found not in marks:
            marks.append(found)
    return marks


def content_pos(record: dict) -> set[str]:
    return {d["part_of_speech"] for d in record["definitions"] if d["part_of_speech"]}


def tokenize(text: str):
    """(token, start, end) over code points. Absent PyThaiNLP the review still runs; it
    simply has no boundaries to work with and returns nothing to suggest."""
    try:
        from pythainlp import word_tokenize
    except Exception:
        return None
    out, cursor = [], 0
    for piece in word_tokenize(text, engine="newmm", keep_whitespace=True):
        start, cursor = cursor, cursor + len(piece)
        out.append((piece, start, cursor))
    return out


def edit_distance_within(a: str, b: str, limit: int = 1) -> bool:
    """Cheap bounded Levenshtein: only used to offer a spelling hint."""
    if abs(len(a) - len(b)) > limit:
        return False
    if a == b:
        return True
    previous = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        current = [i]
        for j, cb in enumerate(b, 1):
            current.append(min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (ca != cb)))
        if min(current) > limit:
            return False
        previous = current
    return previous[-1] <= limit


class ReviewService:
    def __init__(self, settings, repository, search, context, telemetry):
        self.settings, self.repository, self.search = settings, repository, search
        self.context, self.telemetry = context, telemetry
        self._forms: dict[str, str] = {}
        self._forms_dataset = None
        self._lock = threading.Lock()

    def forms(self, dataset_id) -> dict[str, str]:
        """written form -> word_id, for the published release. Cached like the Context
        Lens trie: 51,762 entries is cheap to hold and expensive to rebuild per keystroke."""
        with self._lock:
            if self._forms_dataset != dataset_id:
                self._forms, self._forms_dataset = self.repository.word_forms(dataset_id), dataset_id
            return self._forms

    def review(self, text: str, formality: str, correlation_id: str) -> dict:
        release = self.repository.release()
        forms = self.forms(release["dataset_id"])
        pieces = tokenize(text)
        entries: dict[str, dict] = {}

        def entry(word_id):
            if word_id not in entries:
                try:
                    entries[word_id] = self.repository.lookup(word_id)
                except DomainError:
                    entries[word_id] = None
            return entries[word_id]

        # Two segmenters, each for what it is good at. PyThaiNLP decides where words
        # begin and end. The headword trie decides whether what it found is made of
        # dictionary words: newmm returns ช่วยกัน and ภาษาไทย as single tokens, while RID
        # files ช่วย, กัน and ภาษา, ไทย separately. Calling those "not in the dictionary"
        # would flag ordinary Thai as an error on nearly every line.
        covered = bytearray(len(text))
        parts = []
        for span in self.context.detect(text)["spans"]:
            if entry(span["word_id"]):
                parts.append({"start": span["start"], "end": span["end"], "text": span["text"], "word_id": span["word_id"]})
                for position in range(span["start"], min(span["end"], len(covered))):
                    covered[position] = 1

        subjects, unknown, whole = [], [], set()
        for piece, start, end in pieces or []:
            word = piece.strip()
            if len(word) < MIN_TOKEN or not THAI.search(word):
                continue
            word_id = forms.get(normalize(word))
            if word_id and entry(word_id):
                subjects.append({"start": start, "end": end, "text": piece, "word_id": word_id})
                whole.add((start, end))
            elif all(covered[start:end]):
                continue  # a compound of entries the dictionary does hold
            else:
                unknown.append((word, start, end))

        # Click targets: whole-token entries, plus the sub-words inside compounds so that
        # clicking anywhere in ช่วยกัน still opens an entry.
        tokens = subjects + [p for p in parts if not any(p["start"] >= s and p["end"] <= e for s, e in whole)]
        tokens.sort(key=lambda t: t["start"])

        adapter, degraded_reason = None, None
        try:
            adapter = self.search.load_adapter(release)
        except Exception:
            degraded_reason = "SEMANTIC_INDEX_UNAVAILABLE"
            self.telemetry.emit("dependency", correlation_id, {"dependency": "semantic", "status": "failed"})

        counts: dict[str, int] = {}
        for token in subjects:
            counts[token["word_id"]] = counts.get(token["word_id"], 0) + 1

        suggestions, flagged = [], set()
        for index, token in enumerate(subjects):
            record = entry(token["word_id"])
            found = (
                self._delivery(index, token, record, formality)
                or self._clarity(index, token, record, adapter)
                or self._engagement(index, token, record, adapter, counts, flagged)
            )
            if found:
                suggestions.append(found)
                flagged.add(token["word_id"])
            if len(suggestions) >= MAX_SUGGESTIONS:
                break

        for index, (word, start, end) in enumerate(unknown):
            if len(suggestions) >= MAX_SUGGESTIONS:
                break
            suggestions.append(
                {
                    "id": f"u{index}",
                    "start": start,
                    "end": end,
                    "text": word,
                    "word_id": None,
                    "category": "correctness",
                    "title": "ไม่พบคำนี้ในพจนานุกรม",
                    "message": "อาจสะกดต่างจากรูปที่พจนานุกรมเก็บไว้ หรือเป็นคำที่ชุดข้อมูลนี้ยังไม่ครอบคลุม",
                    "replacements": self._spelling(word, forms, entry),
                    "evidence_ids": [],
                }
            )
        suggestions.sort(key=lambda s: s["start"])

        stats = self._stats(text, pieces, subjects, covered, entries, counts)
        score = 100.0 - sum(PENALTY[s["category"]] for s in suggestions)
        self.telemetry.emit(
            "review",
            correlation_id,
            {"status": "ok", "count": len(suggestions), "degraded": bool(degraded_reason)},
        )
        return {
            "score": max(0, min(100, round(score))),
            "suggestions": suggestions,
            "tokens": tokens,
            "stats": stats,
            "degraded": bool(degraded_reason),
            "degraded_reason": degraded_reason,
        }

    # ---------------- categories ----------------
    def _delivery(self, index, token, record, formality):
        """Flag when most senses carry a flagged mark. A word as ordinary as ช่วย has one
        archaic sense among many; flagging the word for that would be wrong."""
        flags = FORMALITY_FLAGS.get(formality, FORMALITY_FLAGS["neutral"])
        if math.log10(1 + self._frequency(record["word"], frequency_table())) >= COMMON_WORD_LOG:
            return None
        marked = [
            (mark, sense["definition_id"])
            for sense in record["definitions"]
            for mark in sense_marks(sense)
            if mark in flags
        ]
        if not marked or len(marked) < len(record["definitions"]) * MARKED_SENSE_RATIO:
            return None
        mark, definition_id = marked[0]
        return {
            "id": f"d{index}",
            "start": token["start"],
            "end": token["end"],
            "text": token["text"],
            "word_id": token["word_id"],
            "category": "delivery",
            "title": REGISTER_NAMES.get(mark, mark),
            "message": FORMALITY_MESSAGE.get(formality, FORMALITY_MESSAGE["neutral"]),
            "replacements": [],
            "evidence_ids": [definition_id],
        }

    def _clarity(self, index, token, record, adapter):
        table = frequency_table()
        if not adapter or not table:
            return None
        pos = content_pos(record)
        if len(pos) != 1 or not (pos <= CONTENT_POS):
            return None
        own = self._frequency(record["word"], table)
        for near in self._neighbours(adapter, record):
            if near["similarity"] < NEIGHBOUR_FLOOR:
                break
            other = self._lookup(near["word_id"])
            if not other:
                continue
            # A replacement has to be able to stand in the same slot in the sentence.
            if pos and not (pos & {d["part_of_speech"] for d in other["definitions"] if d["part_of_speech"]}):
                continue
            if self._frequency(other["word"], table) >= max(own, 1) * COMMONER_RATIO:
                return {
                    "id": f"c{index}",
                    "start": token["start"],
                    "end": token["end"],
                    "text": token["text"],
                    "word_id": token["word_id"],
                    "category": "clarity",
                    "title": "มีคำที่ใช้กันแพร่หลายกว่า",
                    "message": f"“{other['word']}” พบบ่อยกว่าในคลังข้อความภาษาไทย ผู้อ่านน่าจะคุ้นเคยมากกว่า",
                    "replacements": [self._replacement(near)],
                    "evidence_ids": [record["definitions"][0]["definition_id"]],
                }
        return None

    def _engagement(self, index, token, record, adapter, counts, flagged):
        repeats = counts.get(token["word_id"], 0)
        if not adapter or repeats < REPEAT_THRESHOLD or token["word_id"] in flagged:
            return None
        pos = content_pos(record)
        if len(pos) != 1 or not (pos <= CONTENT_POS):
            return None
        options = [n for n in self._neighbours(adapter, record) if n["similarity"] >= NEIGHBOUR_FLOOR][:3]
        if not options:
            return None
        return {
            "id": f"e{index}",
            "start": token["start"],
            "end": token["end"],
            "text": token["text"],
            "word_id": token["word_id"],
            "category": "engagement",
            "title": f"ใช้คำนี้ {repeats} ครั้ง",
            "message": "ลองสลับไปใช้คำใกล้เคียงเพื่อไม่ให้ข้อความซ้ำ",
            "replacements": [self._replacement(option) for option in options],
            "evidence_ids": [record["definitions"][0]["definition_id"]],
        }

    # ---------------- helpers ----------------
    def _lookup(self, word_id):
        try:
            return self.repository.lookup(word_id)
        except DomainError:
            return None

    @staticmethod
    def _neighbours(adapter, record):
        try:
            return adapter.neighbours([d["definition_id"] for d in record["definitions"]], 8)
        except Exception:
            return []

    def _spelling(self, word, forms, entry):
        """One-character-away written forms. A real typo gets a hint; an invented word
        gets nothing, which is the honest answer."""
        out = []
        for form, word_id in forms.items():
            if len(out) >= 3:
                break
            if form != word and edit_distance_within(word, form):
                record = entry(word_id)
                if record:
                    out.append(
                        {
                            "word": record["word"],
                            "word_id": word_id,
                            "definition": record["definitions"][0]["text"][:160],
                            "reason": "สะกดต่างกันหนึ่งตัวอักษร",
                            "provenance": "SOURCE_DATA",
                        }
                    )
        return out

    @staticmethod
    def _replacement(near):
        return {
            "word": near["word"],
            "word_id": near["word_id"],
            "definition": near.get("description", "")[:160],
            "reason": "คำใกล้เคียงจากดัชนีความหมาย",
            "provenance": "AI_GENERATED_METADATA",
        }

    @staticmethod
    def _frequency(headword, table):
        return max((table.get(form.strip(), 0) for form in (headword or "").split(",")), default=0)

    def _stats(self, text, pieces, tokens, covered, entries, counts):
        words = len([p for p, _, _ in pieces or [] if p.strip() and THAI.search(p)])
        sentences = self._sentences(text)
        known_characters = sum(covered)
        thai_characters = len(THAI.findall(text))
        registers: dict[str, int] = {}
        editions: dict[str, int] = {}
        for token in tokens:
            record = entries.get(token["word_id"])
            if not record:
                continue
            sense = record["definitions"][0]
            for mark in sense_marks(sense):
                label = REGISTER_NAMES.get(mark, mark)
                registers[label] = registers.get(label, 0) + 1
            edition = sense["metadata"].get("edition")
            if edition:
                editions[edition] = editions.get(edition, 0) + 1
        repeated = [
            {"word": entries[word_id]["word"], "count": count}
            for word_id, count in sorted(counts.items(), key=lambda kv: -kv[1])[:6]
            if count >= REPEAT_THRESHOLD and entries.get(word_id)
        ]
        return {
            "characters": len(text),
            "words": words,
            "sentences": sentences,
            "reading_seconds": math.ceil(words / READING_WPM * 60) if words else 0,
            "speaking_seconds": math.ceil(words / SPEAKING_WPM * 60) if words else 0,
            "known_words": len(tokens),
            "coverage": round(known_characters / thai_characters, 3) if thai_characters else 0.0,
            "repeated": repeated,
            "registers": [{"label": k, "count": v} for k, v in sorted(registers.items(), key=lambda kv: -kv[1])],
            "editions": [{"label": k, "count": v} for k, v in sorted(editions.items(), key=lambda kv: -kv[1])],
        }

    @staticmethod
    def _sentences(text: str) -> int:
        """Thai rarely uses a full stop; a blank line or a run of spaces is the real
        sentence break, so count those rather than punctuation alone."""
        if not text.strip():
            return 0
        try:
            from pythainlp import sent_tokenize

            return max(1, len([s for s in sent_tokenize(text) if s.strip()]))
        except Exception:
            return max(1, len([s for s in re.split(r"[.!?ฯ\n]+|\s{2,}", text) if s.strip()]))
