/**
 * Template registry barrel.
 *
 * Split from lib/templates.ts during the large-file refactor.
 * All existing import paths (`from '../../lib/templates'`) continue to work
 * because TypeScript resolves `templates/` directories via `index.ts`.
 */

export type { TemplateParam, TemplateExtras, Template } from './types';
export {
  listTemplates,
  getTemplate,
  renderTemplate,
  defaultValuesFor,
  labelsBlock,
  resourcesRequestsBlock,
} from './registry';
