export * from "./types";
export * from "./intent";
export * from "./validation";
export * from "./completion";
export * from "./legacy";
// v4 storage retirement: the v1 TaskRecord storage entry points are no
// longer part of the production kernel surface. Only the v2 store read/commit
// primitives (used by enrollment/rehearsal/audit) remain exported from
// ./storage; the v1 writer/reader names are absent.
export {
	readWorkspaceStateRaw,
	readTaskRecordRaw,
	readTaskRecord,
	readSecureProjectFile,
	commitTaskRecordLocked,
	withKernelStoreLock,
	serializeWorkspace,
	revisionForContent,
	appendJournalEntry,
	KernelStoreSecurityError,
	setAfterTaskTransactionWriteForTest,
} from "./storage";
export {
	reduceTask,
	canonicalRecordHash,
	actionFingerprint,
	recordedActionFingerprint,
	isReducedMutation,
} from "./reducer";
