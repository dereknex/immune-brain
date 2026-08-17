// Phase 2: /imm-canary-new is a visible TUI launcher only. The Parent owns
// one foreground imm_canary_enrollment Tool invocation and consumes its direct
// terminal result. This command performs no preparation, confirmation, or
// authority work.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { launchEnrollmentRequest } from "./imm-canary-enroll";

export default function (pi: ExtensionAPI) {
	pi.registerCommand("imm-canary-new", {
		description: "Request default Kernel task enrollment through the foreground Tool (no waiver)",
		handler: (args, ctx) => launchEnrollmentRequest(pi, "new", args, ctx),
	});
}
