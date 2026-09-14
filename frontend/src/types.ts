export type Provenance = 'SOURCE_DATA' | 'CURATED_METADATA' | 'AI_GENERATED_METADATA' | 'USER_GENERATED_DATA'
export interface Source { source_id: string; version: string; dataset_id: string; name: string; license: string; license_url: string; official_royal_society: false; provenance: Provenance }
export interface Definition { definition_id: string; number: number; text: string; part_of_speech: string | null; metadata: Record<string, string | null>; record_url: string; history_url: string; provenance: Provenance; source: Source }
export interface Metadata { id: string; definition_id?: string; kind: string; text: string; evidence_ids: string[]; process_id: string; provenance: Provenance }
export interface Word { word_id: string; word: string; dataset_id: string; definitions: Definition[]; source: Source; curated_metadata: Metadata[]; ai_generated_metadata: Metadata[]; feedback_target?: string }
export interface Candidate { word_id: string; word: string; definition_id: string; description: string; match_type: 'exact' | 'partial' | 'semantic'; score: number; sense_count: number; source: Source; evidence_ids: string[] }
export interface SearchResults { candidates: Candidate[]; state: string; degraded: boolean; degraded_reason?: string; semantic_state?: string; embedding_model?: string; retrieval_mode: string; has_more: boolean; offset: number; feedback_target: string }
export interface Claim { word: string; number: number; text: string; evidence_ids: string[]; source_version: string; provenance: Provenance }
export interface Evidence extends Definition { word: string; word_id: string }
export interface Explanation { state: string; reason?: string; text?: string; claims: Claim[]; evidence: Evidence[]; provenance: Provenance; mode?: string; limitation?: string; curated_metadata?: Metadata[]; feedback_target?: string }
export interface Related { center: { word_id: string; word: string }; relationships: Edge[]; state: string; dataset_id: string; feedback_target?: string }
export interface Edge { relationship_id: string; to_id: string; word_id?: string; type: string; word: string; description: string; provenance: Provenance; process_id: string; evidence_ids: string[]; source: Source; qualification?: string; generated_explanation?: Explanation; source_word_id?: string; target_word_id?: string; publication_state?: string; eligible?: boolean }
export interface Span { word_id: string; text: string; start: number; end: number }
export interface ContextResult { selection: Span; word: Word; sense_ids: string[]; ambiguous: boolean; explanation: Explanation; alternatives: Edge[]; feedback_target?: string }
export interface Config { query_limit: number; context_limit: number; map_limit: number; provider_mode: string; remote_processing?: boolean; llm_model?: string; embedding_model?: string; analytics_enabled: boolean; retention_days: number; source_notice: string }
