import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createSailProvider } from "./models.ts";

export const SAIL_PROVIDER_ID = "sailresearch";
export const SAIL_BALANCED_PROVIDER_ID = "sailresearch-balanced";

export default function sailResearchExtension(pi: ExtensionAPI): void {
	pi.registerProvider(
		createSailProvider(SAIL_PROVIDER_ID, "Sail Research (ASAP)", "asap"),
	);
	pi.registerProvider(
		createSailProvider(SAIL_BALANCED_PROVIDER_ID, "Sail Research (Balanced)", "balanced"),
	);
}
