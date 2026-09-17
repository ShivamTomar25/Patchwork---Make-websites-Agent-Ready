import type { TypedPatch } from "../schemas.js";

export type PatchProposalRequest = {
  replica: string;
  journeyId: string;
  defectId: string;
  targetNodeId: string;
  operator: string;
  maxOutputTokens: number;
};

export interface PatchProposalProvider {
  proposePatch(request: PatchProposalRequest): Promise<TypedPatch>;
}

export class DisabledPatchProposalProvider implements PatchProposalProvider {
  async proposePatch(): Promise<TypedPatch> {
    throw new Error("PATCH_PROPOSAL_PROVIDER_DISABLED: deterministic templates are required for repair-pilot-v1");
  }
}
