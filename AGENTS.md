# Agentes de IA neste repositório

## Skills de Instagram

Nove skills de marketing para Instagram (origem: https://github.com/sergebulaev/instagram-skills, MIT, v1.0.27).
Para qualquer tarefa de Instagram (legenda, carrossel, plano semanal, hashtags, bio, reaproveitar conteúdo),
leia primeiro o `SKILL.md` da skill correspondente em `.claude/skills/<nome>/`.

- Claude Code (CLI, web, desktop, IDE): descobre `.claude/skills/` automaticamente.
- Codex / agentes que leem `.agents/skills/`: `.agents/skills` é um link simbólico para `.claude/skills`.
- Outros agentes (OpenClaw, Hermes, Cursor...): apontar para `.claude/skills/*/SKILL.md`.

As skills usam `../../references/` (= `.claude/references/`) e o pacote Python `lib` (= `.claude/lib/`):

```bash
pip install -r .claude/requirements.txt   # opcional: só para publicar (Publora) ou ler dados (Apify)
PYTHONPATH=.claude python3 -c "import lib"
```

Chaves opcionais: copie `.env.example` para `.env`. Sem chaves, as skills só redigem o texto e você publica no app.
Nada é publicado sem aprovação explícita do usuário.
