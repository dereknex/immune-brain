export {
	VERIFICATION_DESCRIPTOR_CONTRACT,
	parseVerificationDescriptor,
	canonicalDescriptorBytes,
	VerificationDescriptorError,
	VERIFICATION_DESCRIPTOR_BOUNDS,
	type VerificationDescriptor,
} from "../runtime/verification_descriptor";
export {
	resolveVerificationCommand,
	assertCommandIdentity,
	runFixedVerification,
	findingsDigest,
	VerificationAbortedError,
	type FrozenCommand,
} from "../runtime/assurance/verification";
