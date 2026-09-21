import { requireEnumValue } from "./validation.js";

export const CHANGE_CATEGORIES = Object.freeze([
  "AUTHENTICATION",
  "AUTHORIZATION",
  "DATABASE",
  "API",
  "DEPENDENCY",
  "CONFIGURATION",
  "FRONTEND",
  "TEST",
  "GENERAL",
] as const);
export type ChangeCategory = (typeof CHANGE_CATEGORIES)[number];
export const parseChangeCategory = (value: unknown): ChangeCategory =>
  requireEnumValue(value, CHANGE_CATEGORIES, "changeCategory");

export const RISK_LEVELS = Object.freeze(["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const);
export type RiskLevel = (typeof RISK_LEVELS)[number];
export const parseRiskLevel = (value: unknown): RiskLevel =>
  requireEnumValue(value, RISK_LEVELS, "riskLevel");

export const VERIFICATION_VERDICTS = Object.freeze(["APPROVE", "BLOCK", "INCONCLUSIVE"] as const);
export type VerificationVerdict = (typeof VERIFICATION_VERDICTS)[number];
export const parseVerificationVerdict = (value: unknown): VerificationVerdict =>
  requireEnumValue(value, VERIFICATION_VERDICTS, "verificationVerdict");

export const VERIFICATION_STRATEGIES = Object.freeze([
  "BUILD",
  "EXISTING_TESTS",
  "STATIC_ANALYSIS",
  "AUTHENTICATION_VERIFICATION",
  "AUTHORIZATION_VERIFICATION",
  "API_CONTRACT_VERIFICATION",
  "DATABASE_MIGRATION_VERIFICATION",
  "DEPENDENCY_VERIFICATION",
  "CONFIGURATION_VERIFICATION",
  "FRONTEND_BEHAVIOR_VERIFICATION",
] as const);
export type VerificationStrategy = (typeof VERIFICATION_STRATEGIES)[number];
export const parseVerificationStrategy = (value: unknown): VerificationStrategy =>
  requireEnumValue(value, VERIFICATION_STRATEGIES, "verificationStrategy");

export const CHECK_RESULT_STATES = Object.freeze([
  "PASS",
  "FAIL",
  "ERROR",
  "TIMEOUT",
  "CANCELLED",
  "SKIPPED",
  "UNSUPPORTED",
] as const);
export type CheckResultState = (typeof CHECK_RESULT_STATES)[number];
export const parseCheckResultState = (value: unknown): CheckResultState =>
  requireEnumValue(value, CHECK_RESULT_STATES, "checkResultState");

export const CHANGED_FILE_STATUSES = Object.freeze([
  "ADDED",
  "MODIFIED",
  "DELETED",
  "RENAMED",
  "COPIED",
  "TYPE_CHANGED",
  "UNMERGED",
  "UNSUPPORTED",
] as const);
export type ChangedFileStatus = (typeof CHANGED_FILE_STATUSES)[number];
export const parseChangedFileStatus = (value: unknown): ChangedFileStatus =>
  requireEnumValue(value, CHANGED_FILE_STATUSES, "changedFileStatus");

export const STRATEGY_DISPOSITIONS = Object.freeze([
  "MANDATORY",
  "OPTIONAL",
  "UNSUPPORTED",
  "UNNECESSARY",
] as const);
export type StrategyDisposition = (typeof STRATEGY_DISPOSITIONS)[number];
export const parseStrategyDisposition = (value: unknown): StrategyDisposition =>
  requireEnumValue(value, STRATEGY_DISPOSITIONS, "strategyDisposition");

export const UNAVAILABLE_STRATEGY_BEHAVIORS = Object.freeze(["INCONCLUSIVE", "BLOCK"] as const);
export type UnavailableStrategyBehavior = (typeof UNAVAILABLE_STRATEGY_BEHAVIORS)[number];
export const parseUnavailableStrategyBehavior = (value: unknown): UnavailableStrategyBehavior =>
  requireEnumValue(value, UNAVAILABLE_STRATEGY_BEHAVIORS, "unavailableStrategyBehavior");

export const RUN_LIFECYCLE_STATES = Object.freeze([
  "QUEUED",
  "ANALYZING",
  "CLASSIFYING",
  "ASSESSING_RISK",
  "PLANNING",
  "EXECUTING",
  "EVALUATING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
] as const);
export type RunLifecycleState = (typeof RUN_LIFECYCLE_STATES)[number];
export const parseRunLifecycleState = (value: unknown): RunLifecycleState =>
  requireEnumValue(value, RUN_LIFECYCLE_STATES, "runLifecycleState");

export const EVIDENCE_COMPLETENESS = Object.freeze(["COMPLETE", "TRUNCATED"] as const);
export type EvidenceCompleteness = (typeof EVIDENCE_COMPLETENESS)[number];
export const parseEvidenceCompleteness = (value: unknown): EvidenceCompleteness =>
  requireEnumValue(value, EVIDENCE_COMPLETENESS, "evidenceCompleteness");

export const EVIDENCE_SENSITIVITIES = Object.freeze(["PUBLIC", "INTERNAL", "SENSITIVE"] as const);
export type EvidenceSensitivity = (typeof EVIDENCE_SENSITIVITIES)[number];
export const parseEvidenceSensitivity = (value: unknown): EvidenceSensitivity =>
  requireEnumValue(value, EVIDENCE_SENSITIVITIES, "evidenceSensitivity");
