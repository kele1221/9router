# 项目初始化

## Goal

Initialize Trellis development workflow system for 9router project — copy core files, set up developer identity, bootstrap project-specific coding specs from real codebase analysis.

## Requirements

- `.trellis/` directory with workflow, config, scripts, spec templates
- `.claude/` hooks/skills/agents/commands for Trellis integration (gitignored, local only)
- Developer identity initialized
- `.trellis/spec/` populated with real, codebase-backed guidelines per package/layer
- Task system ready for future development work
- Python 3.12+ path configured in hooks

## Acceptance Criteria

- [ ] `.trellis/` tracked in git, `.claude/` in gitignore
- [ ] `task.py` works with Python 3.12
- [ ] `.trellis/spec/` describes the project as it exists
- [ ] Hooks fire on session start / user prompt submit / sub-agent dispatch
- [ ] `/trellis:finish-work` can complete a task lifecycle

## Notes

- Use `trellis-spec-bootstrap` skill for spec generation
- Spec files must have real code examples, not placeholder text