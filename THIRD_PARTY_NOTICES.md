# Third-party notices

## Selected corpus: rid 1.0

Office of the Royal Society (สำนักงานราชบัณฑิตยสภา). พจนานุกรมฉบับราชบัณฑิตยสภา editions ๒๕๔๒, ๒๕๕๔ and ๒๕๖๙ (including the marked-incomplete ๒๕๖๙ draft), the Society's coined-term lists for แพทยศาสตร์, จิตวิทยา and ปรัชญา, its English→Thai transliteration list, and its northern, southern and Isaan dialect word lists.

**This content is copyright the Office of the Royal Society and is not redistributable.** It is not distributed with KhamLink, is not committed to this repository, and is never downloaded by the setup script; an operator must supply it and is responsible for holding the right to use it. It is served here on the basis of study and research use. The normalisation pipeline (`etl.py`) preserves the original Thai strings verbatim in a `raw` column; KhamLink adds stable identifiers, splits senses into rows and derives a retrieval index, and none of those derived artifacts change the underlying rights. The Office of the Royal Society does not endorse KhamLink.

The selected artifact, editions, per-edition row counts, coverage limits, normalisation note, size and SHA-256 are recorded in [`sources/rid-1.0.json`](sources/rid-1.0.json). Coverage is uneven and the manifest states it: ๒๕๔๒ is complete ก–ฮ, ๒๕๕๔ covers only ก–ซ, and both ๒๕๖๙ sets cover only ก.

## Alternate corpus: thai_dict 1.0 (no longer the default)

Retained and still selectable by pointing `KHAMLINK_SOURCE_MANIFEST` at it; the CSV staging path and its tests are unchanged. Thai Wiktionary contributors; compiled by Wannaphong Phatthiyaphaibun / PyThaiNLP. The [artifact release](https://github.com/PyThaiNLP/pythainlp-corpus/releases/tag/thai_dict-v1.0) identifies Thai Wiktionary as its origin and **Creative Commons Attribution-ShareAlike 4.0 International** as its license. This is an artifact-specific determination, not an inference from the corpus repository's general license. [License and legal-code link](https://creativecommons.org/licenses/by-sa/4.0/).

The selected artifact, source URLs, registry commit, size, SHA-256, date, author attribution and limitations are recorded in [`sources/thai_dict-1.0.json`](sources/thai_dict-1.0.json). No upstream checksum was supplied; KhamLink pins the measured SHA-256 and verifies subsequent downloads. No large corpus file is included in this source tree's deliverable.

KhamLink's data transformations parse CSV meaning dictionaries, split/number senses, add IDs/source links, omit unmapped optional POS with quality flags, and create a separate derived retrieval index. Original Thai display strings and definitions are preserved. The normalized/adapted corpus data is made available under CC BY-SA 4.0 with attribution and modification notices retained. Source content and source excerpts shown in explanations retain the underlying data license. Do not apply additional restrictions to this licensed material. This notice does not purport to relicense unrelated application code.

Live per-word Thai Wiktionary article/history links identify contributing pages, but the release has no per-entry revision IDs. Frozen wording is bound to the downloaded artifact checksum, not represented as the current page's exact contents. This corpus is **not an official Office of the Royal Society dictionary**, and neither Wikimedia nor PyThaiNLP endorses KhamLink.

## BGE-M3 and bge-reranker-v2-m3

[BAAI/bge-m3](https://huggingface.co/BAAI/bge-m3) and [BAAI/bge-reranker-v2-m3](https://huggingface.co/BAAI/bge-reranker-v2-m3), MIT License, copyright Beijing Academy of Artificial Intelligence. Weights are **not** shipped in this repository; they are downloaded from Hugging Face on first use and cached under the user's Hugging Face cache. `embeddings.parquet` contains vectors derived from BGE-M3 over the source corpus; those vectors inherit the corpus's licensing restrictions, not the model's. Neither BAAI nor Hugging Face endorses KhamLink.

## PyThaiNLP library

Version **5.3.7**, Apache License 2.0; copyright PyThaiNLP contributors. Its installed package contains its license and notices. [PyThaiNLP source and license](https://github.com/PyThaiNLP/pythainlp). The library license is separate from the dictionary corpus's license. The Thai National Corpus and Thai Textbook Corpus word-frequency tables distributed with PyThaiNLP are used for the ranking frequency prior; no other downloaded PyThaiNLP corpus is approved by this notice.

## HippoRAG

Method/reference: [OSU-NLP-Group/HippoRAG](https://github.com/OSU-NLP-Group/HippoRAG/tree/1438aba3fc44ff10573e5a5e1e7cc3c7f9794aff), commit `1438aba3fc44ff10573e5a5e1e7cc3c7f9794aff`, package metadata `2.0.0a5`. [HippoRAG 2 paper](https://arxiv.org/abs/2502.14802). The official package is not installed; the local compatible-method adapter and its deviations are described in [architecture](docs/architecture.md). The upstream MIT attribution is retained below, from its [license file](https://github.com/OSU-NLP-Group/HippoRAG/blob/1438aba3fc44ff10573e5a5e1e7cc3c7f9794aff/LICENSE).

MIT License

Copyright (c) 2025 OSU Natural Language Processing

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

## Embeddings and generation

Default `thai-char-lsa-v1-d128` uses scikit-learn TF-IDF/SVD trained locally on the selected corpus. No third-party neural model weights are shipped. `dictionary-openie-extractive-v1`, `recognition-local-v1`, and `local-extractive-summary-v1` are local deterministic adapters. Derived corpus/index artifacts remain separated from source and retain corpus attribution. Optional neural/remote models require their own pinned revision, license/terms and processing approval before use; naming a configurable model does not approve its weights or license.

## Software dependencies and release packaging

Python versions are locked in `requirements.lock`; npm dependency versions and integrity hashes in `frontend/package-lock.json`. Preserve the licenses supplied with installed distributions, including transitive dependencies and bundled native runtimes. React/ReactDOM and the Vite build tool supply MIT notices; Python numerical wheels may contain additional BLAS/runtime notices beyond their top-level licenses. Playwright's browser distribution has its own bundled notices and is test-only, not an application runtime asset.

Every frontend build emits `assets/THIRD_PARTY_NOTICES.txt` from the actual installed React, ReactDOM, scheduler and Vite license files, including their copyright notices. The build fails if a required notice is missing. This file travels with the standalone frontend/Docker build and is available at `/assets/THIRD_PARTY_NOTICES.txt`; no attribution depends on retaining development `node_modules` in the deployed frontend.

Before distributing an image or binary, run `python scripts/license_inventory.py` in its environment. It writes a machine-readable inventory and copies actual installed license/NOTICE texts to ignored `artifacts/licenses/`. Bundle those generated notices with that distribution; do not rely on a top-level license label to replace bundled native-component notices. This inventory is release evidence, not legal approval of Q-003/Q-005.
