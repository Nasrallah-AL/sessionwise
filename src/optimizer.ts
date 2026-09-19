import type {
  OptimizableRequest,
  OptimizationProposal,
  OptimizerMode,
  Recommendation,
} from "./types.js";

export interface ControlledOptimizerOptions<T extends OptimizableRequest> {
  mode?: OptimizerMode;
  propose: (request: T, recommendations: Recommendation[]) => OptimizationProposal<T>[] | Promise<OptimizationProposal<T>[]>;
  approve?: (proposal: OptimizationProposal<T>) => boolean | Promise<boolean>;
  onProposal?: (proposal: OptimizationProposal<T>, applied: boolean) => void | Promise<void>;
}

export function createControlledOptimizer<T extends OptimizableRequest>(
  options: ControlledOptimizerOptions<T>,
) {
  const mode = options.mode ?? "recommend";

  return {
    mode,
    async beforeCall(request: T, recommendations: Recommendation[]): Promise<T> {
      const proposals = await options.propose(request, recommendations);
      let next = request;

      for (const proposal of proposals) {
        const approved = mode === "controlled" && options.approve
          ? await options.approve(proposal)
          : false;
        if (approved) next = { ...next, ...proposal.patch };
        await options.onProposal?.(proposal, approved);
      }

      return next;
    },
  };
}
