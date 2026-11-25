import {
  getPublicToolDetailTemporalIssues,
  getPublicToolSummaryTemporalIssues,
  normalizePublicToolFeedFreshness,
  type PublicToolFeedTemporalIssue,
  type PublicToolFeedTemporalDetail,
  type PublicToolFeedTemporalSummary,
} from '../publishedToolFeedSchemas.js';
import type { z } from 'zod';

export { normalizePublicToolFeedFreshness };

interface ToolSummaryCollection {
  tools: PublicToolFeedTemporalSummary[];
}

interface ToolStackCollection {
  stacks: Array<{
    tools: Array<{ tool?: PublicToolFeedTemporalSummary }>;
  }>;
}

interface CuratedListCollection {
  best: Array<{
    rankedTools: Array<{ tool?: PublicToolFeedTemporalSummary }>;
  }>;
}

interface CategoryCollection {
  categories: Array<{ featuredTools?: PublicToolFeedTemporalSummary[] }>;
}

interface UseCaseCollection {
  useCases: Array<{ tools?: PublicToolFeedTemporalSummary[] }>;
}

interface AlternativesIndexCollection {
  sets: Array<{ alternatives?: PublicToolFeedTemporalSummary[] }>;
}

interface AlternativesDetailData {
  alternatives?: PublicToolFeedTemporalSummary[];
  sourceTool?: PublicToolFeedTemporalSummary;
}

interface ComparisonsIndexCollection {
  comparisons: Array<{
    primary?: PublicToolFeedTemporalSummary;
    secondary?: PublicToolFeedTemporalSummary;
  }>;
}

interface ComparisonDetailData {
  primary?: PublicToolFeedTemporalSummary;
  secondary?: PublicToolFeedTemporalSummary;
}

const addTemporalIssues = (
  issues: PublicToolFeedTemporalIssue[],
  context: z.RefinementCtx,
): void => {
  issues.forEach((issue) =>
    context.addIssue({
      code: 'custom',
      path: ['data', ...issue.path],
      message: issue.message,
    }),
  );
};

const addSummaryIssues = (
  tool: PublicToolFeedTemporalSummary,
  referenceTime: Date,
  path: Array<string | number>,
  context: z.RefinementCtx,
): void =>
  addTemporalIssues(getPublicToolSummaryTemporalIssues(tool, referenceTime, path), context);

export const toolProfileTemporalValidators = {
  toolDetail(
    tool: PublicToolFeedTemporalDetail,
    referenceTime: Date,
    context: z.RefinementCtx,
  ): void {
    addTemporalIssues(getPublicToolDetailTemporalIssues(tool, referenceTime), context);
  },

  tools(data: ToolSummaryCollection, referenceTime: Date, context: z.RefinementCtx): void {
    data.tools.forEach((tool, index) =>
      addSummaryIssues(tool, referenceTime, ['tools', index], context),
    );
  },

  stacks(data: ToolStackCollection, referenceTime: Date, context: z.RefinementCtx): void {
    data.stacks.forEach((stack, stackIndex) =>
      stack.tools.forEach(({ tool }, toolIndex) => {
        if (tool) {
          addSummaryIssues(
            tool,
            referenceTime,
            ['stacks', stackIndex, 'tools', toolIndex, 'tool'],
            context,
          );
        }
      }),
    );
  },

  best(data: CuratedListCollection, referenceTime: Date, context: z.RefinementCtx): void {
    data.best.forEach((list, listIndex) =>
      list.rankedTools.forEach(({ tool }, toolIndex) => {
        if (tool) {
          addSummaryIssues(
            tool,
            referenceTime,
            ['best', listIndex, 'rankedTools', toolIndex, 'tool'],
            context,
          );
        }
      }),
    );
  },

  categories(data: CategoryCollection, referenceTime: Date, context: z.RefinementCtx): void {
    data.categories.forEach((category, categoryIndex) =>
      category.featuredTools?.forEach((tool, toolIndex) =>
        addSummaryIssues(
          tool,
          referenceTime,
          ['categories', categoryIndex, 'featuredTools', toolIndex],
          context,
        ),
      ),
    );
  },

  useCases(data: UseCaseCollection, referenceTime: Date, context: z.RefinementCtx): void {
    data.useCases.forEach((useCase, useCaseIndex) =>
      useCase.tools?.forEach((tool, toolIndex) =>
        addSummaryIssues(
          tool,
          referenceTime,
          ['useCases', useCaseIndex, 'tools', toolIndex],
          context,
        ),
      ),
    );
  },

  alternativesIndex(
    data: AlternativesIndexCollection,
    referenceTime: Date,
    context: z.RefinementCtx,
  ): void {
    data.sets.forEach((set, setIndex) =>
      set.alternatives?.forEach((tool, toolIndex) =>
        addSummaryIssues(
          tool,
          referenceTime,
          ['sets', setIndex, 'alternatives', toolIndex],
          context,
        ),
      ),
    );
  },

  alternativesDetail(
    data: AlternativesDetailData,
    referenceTime: Date,
    context: z.RefinementCtx,
  ): void {
    data.alternatives?.forEach((tool, toolIndex) =>
      addSummaryIssues(tool, referenceTime, ['alternatives', toolIndex], context),
    );
    if (data.sourceTool) {
      addSummaryIssues(data.sourceTool, referenceTime, ['sourceTool'], context);
    }
  },

  comparisonsIndex(
    data: ComparisonsIndexCollection,
    referenceTime: Date,
    context: z.RefinementCtx,
  ): void {
    data.comparisons.forEach((pair, pairIndex) => {
      if (pair.primary) {
        addSummaryIssues(
          pair.primary,
          referenceTime,
          ['comparisons', pairIndex, 'primary'],
          context,
        );
      }
      if (pair.secondary) {
        addSummaryIssues(
          pair.secondary,
          referenceTime,
          ['comparisons', pairIndex, 'secondary'],
          context,
        );
      }
    });
  },

  comparisonsDetail(
    data: ComparisonDetailData,
    referenceTime: Date,
    context: z.RefinementCtx,
  ): void {
    if (data.primary) {
      addSummaryIssues(data.primary, referenceTime, ['primary'], context);
    }
    if (data.secondary) {
      addSummaryIssues(data.secondary, referenceTime, ['secondary'], context);
    }
  },
};
