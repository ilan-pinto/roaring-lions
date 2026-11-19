// Types for validate_entity_budget.mjs, so tools/src/validate_entity_budget.test.ts typechecks.
export declare const AUTHORED_ENTITY_BUDGET: number;
export interface AuthoredEntityParts {
  starting_force: number;
  civilians: number;
  garrison: number;
  waves: number;
  triggers: number;
}
export declare function authoredEntityCount(mission: unknown): { total: number; parts: AuthoredEntityParts };
export declare function entityBudgetFailures(mission: unknown, file: string, budget?: number): string[];
