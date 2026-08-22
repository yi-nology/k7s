/**
 * Tests for SkillsPanel — the k8s skill market inside the AI panel.
 *
 * Covers: loading state, grouping by category, skill card contents,
 * active-skill highlight, and select/deselect clicks.
 *
 * The provider is mocked (aiListSkills) following the established panel-test
 * pattern. Locale is pinned to en by the global test setup.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SkillsPanel } from './SkillsPanel';
import { render, cleanup, type RenderResult } from '../../test/componentUtils';
import type { Skill } from '../../lib/ai/types';

const skillMocks = vi.hoisted(() => ({ aiListSkills: vi.fn() }));
vi.mock('../../providers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../providers')>();
  return {
    ...actual,
    getProvider: () => ({
      aiListSkills: skillMocks.aiListSkills,
    }),
  };
});

function makeSkill(overrides: Partial<Skill> = {}): Skill {
  return {
    id: 'troubleshooting',
    name: 'Troubleshooting',
    description: 'Systematic debugging strategies.',
    systemPromptSuffix: '',
    toolWhitelist: ['list_pods', 'get_events'],
    examples: [],
    category: 'diagnostics',
    ...overrides,
  };
}

let view: RenderResult;

beforeEach(() => {
  skillMocks.aiListSkills.mockReset();
});

afterEach(() => {
  cleanup();
});

describe('SkillsPanel', () => {
  it('shows the loading state while skills are fetched', () => {
    skillMocks.aiListSkills.mockReturnValue(new Promise(() => {})); // never resolves
    view = render(<SkillsPanel onSelect={vi.fn()} />);
    expect(view.queryByText('Loading skills…')).not.toBeNull();
  });

  it('renders skills grouped under their category', async () => {
    skillMocks.aiListSkills.mockResolvedValue([
      makeSkill(),
      makeSkill({
        id: 'scaling',
        name: 'Scaling',
        description: 'How to scale workloads.',
        category: 'operations',
        toolWhitelist: [],
      }),
    ]);
    view = render(<SkillsPanel onSelect={vi.fn()} />);
    await vi.waitFor(() => {
      expect(view.queryByText('Troubleshooting')).not.toBeNull();
    });
    // Category headers (rendered capitalized).
    expect(view.queryByText('diagnostics')).not.toBeNull();
    expect(view.queryByText('operations')).not.toBeNull();
    expect(view.queryByText('Scaling')).not.toBeNull();
  });

  it('renders each skill description and tool whitelist', async () => {
    skillMocks.aiListSkills.mockResolvedValue([makeSkill()]);
    view = render(<SkillsPanel onSelect={vi.fn()} />);
    await vi.waitFor(() => {
      expect(view.queryByText('Systematic debugging strategies.')).not.toBeNull();
    });
    expect(view.queryByText(/Tools:/)).not.toBeNull();
    expect(view.queryByText(/list_pods/)).not.toBeNull();
  });

  it('shows the active badge on the selected skill', async () => {
    skillMocks.aiListSkills.mockResolvedValue([makeSkill()]);
    view = render(<SkillsPanel activeId="troubleshooting" onSelect={vi.fn()} />);
    await vi.waitFor(() => {
      expect(view.queryByText('Troubleshooting')).not.toBeNull();
    });
    expect(view.queryByText('active')).not.toBeNull();
  });

  it('selects a skill on click and deselects the active one', async () => {
    const onSelect = vi.fn();
    skillMocks.aiListSkills.mockResolvedValue([makeSkill()]);
    view = render(<SkillsPanel activeId="troubleshooting" onSelect={onSelect} />);
    await vi.waitFor(() => {
      expect(view.queryByText('Troubleshooting')).not.toBeNull();
    });

    // Already active → clicking clears the selection.
    view.click(view.getByText('Troubleshooting'));
    expect(onSelect).toHaveBeenCalledWith(undefined);

    // Inactive → clicking selects it.
    view = render(<SkillsPanel onSelect={onSelect} />);
    await vi.waitFor(() => {
      expect(view.queryByText('Troubleshooting')).not.toBeNull();
    });
    view.click(view.getByText('Troubleshooting'));
    expect(onSelect).toHaveBeenCalledWith('troubleshooting');
  });

  it('renders an empty list without crashing when no skills exist', async () => {
    skillMocks.aiListSkills.mockResolvedValue([]);
    view = render(<SkillsPanel onSelect={vi.fn()} />);
    await vi.waitFor(() => {
      expect(view.queryByText('Loading skills…')).toBeNull();
    });
    expect(view.container.firstChild).not.toBeNull();
  });

  it('swallows fetch errors and renders the empty panel', async () => {
    skillMocks.aiListSkills.mockRejectedValue(new Error('ai offline'));
    view = render(<SkillsPanel onSelect={vi.fn()} />);
    await vi.waitFor(() => {
      expect(view.queryByText('Loading skills…')).toBeNull();
    });
    expect(view.container.firstChild).not.toBeNull();
  });
});
