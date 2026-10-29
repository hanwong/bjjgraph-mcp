# bjjgraph-mcp

A small local [MCP](https://modelcontextprotocol.io) server that lets Claude (Claude Code, Claude Desktop) look things up in [BJJGraph](https://github.com/diogoseca/bjjgraph) — a directed graph of Brazilian Jiu-Jitsu positions (each with a top and bottom role), transitions, submissions, systems, principles and learning notes.

Ask things like *"How do I get from half guard bottom to the back?"* and Claude answers from the graph: routes, step-by-step execution, counters, common errors and defensive options.

> [!IMPORTANT]
> **This repository contains code only. It does not include BJJGraph data.**
>
> - The **code** here is MIT-licensed (see [LICENSE](LICENSE)).
> - The **BJJGraph data** is © Diogo Seca and licensed under [PolyForm Noncommercial 1.0.0](https://github.com/diogoseca/bjjgraph/blob/main/LICENSE.md). It is **not included**. Each user downloads it themselves with `npm run fetch-data`, and may use it for **noncommercial purposes only**, under that licence's terms.
> - Per its own README, BJJGraph content is produced with AI-assisted generation, and its probabilities are **authored estimates** that have not been validated by a panel of black belts. Treat it as a **study aid, not ground truth**.
>
> This project is not affiliated with or endorsed by BJJGraph or its author.

## Requirements

- Node.js 20 or newer
- About 45 MB of disk space for the downloaded data

## Install

```bash
git clone https://github.com/hanwong/bjjgraph-mcp.git
cd bjjgraph-mcp
npm install        # also builds the server into dist/
npm run fetch-data # downloads BJJGraph's content JSON into data/bjjgraph.json
```

`fetch-data` downloads the BJJGraph repository archive from GitHub, keeps only `content/**/*.json` (positions, transitions, submissions, systems, principles, learning), and saves one bundle file in `data/` (git-ignored). Downloaded files are only parsed as JSON — nothing from the download is extracted or executed. BJJGraph changes often; rerun `npm run fetch-data` any time to refresh. The server notices the new file automatically.

Options: `npm run fetch-data -- --ref <branch-or-commit>` and `--out <file>`. To use a BJJGraph checkout you already have, set `BJJGRAPH_DATA` to its folder (or to a bundle file).

## Add to Claude Code

From inside the `bjjgraph-mcp` folder:

```bash
claude mcp add bjjgraph --scope user -- node "$(pwd)/dist/src/index.js"
```

Then run `claude mcp list` to confirm it shows `bjjgraph: ... ✓ Connected`.

## Add to Claude Desktop

Open **Settings → Developer → Edit Config** (this opens `claude_desktop_config.json`) and add the server, using the absolute path to your clone:

```json
{
  "mcpServers": {
    "bjjgraph": {
      "command": "node",
      "args": ["/absolute/path/to/bjjgraph-mcp/dist/src/index.js"]
    }
  }
}
```

Restart Claude Desktop.

## Tools

| Tool | What it does |
| --- | --- |
| `bjj_search` | Fuzzy search by name or alias across positions, transitions, submissions, systems, principles and learning notes. Partial names and typos work; common Korean terms (하프가드, 백, 암바…) are translated. |
| `bjj_get_technique` | Full detail for a transition or submission: outcomes and probabilities, conditions, key principles, setup, execution steps, counters, common errors, training progressions, defender cues and options, variants, safety, clips. Filter with `sections` and `perspective`. |
| `bjj_get_position` | A position for the top and/or bottom role: overview, properties and metrics, principles, decision tree, errors, drills, technique menu, clips. |
| `bjj_position_options` | What can be attempted from a position and role, most common first, with where each outcome leads. |
| `bjj_find_paths` | A few shortest routes between two positions using only successful outcomes, with the techniques for each step. The goal can also be a submission (e.g. "Armbar"). |
| `bjj_list` | Lists systems, principles, learning notes, positions or submission families. |
| `bjj_get_concept` | Full content of a system, principle or learning note. |
| `bjj_about` | Loaded data version (commit, date, counts), how to refresh, licence. |

Long results are paged (`page`, `max_chars`; default 6,000 characters) so they don't flood the conversation.

**Roles.** States are written `Position/Role`, from the point of view of whoever does the technique: `Back Control/Top` means *you* have the back; `Half Guard/Bottom` means you are playing half guard.

## Example questions

- "How do I get from half guard bottom to back control?"
- "What can I do from closed guard bottom in no-gi?"
- "Show me the execution steps and common errors for the Kimura Sweep."
- "How do I defend the triangle? Give me the defender's recognition cues."
- "Find a route from side control bottom to mount top."
- "Which principles does BJJGraph list? Explain Pressure."
- "What systems are there for half guard?"

## Development

```bash
npm test            # builds, then runs tests against a tiny made-up fixture (test/fixture)
npm run check-data  # sanity checks every tool and entry against your downloaded data
```

## 한국어 안내

Claude(Claude Code, Claude Desktop)가 [BJJGraph](https://github.com/diogoseca/bjjgraph)의 주짓수 포지션·기술·서브미션·시스템·원리를 찾아볼 수 있게 해 주는 로컬 MCP 서버입니다. 예를 들어 "하프가드에서 백까지 가는 방법 알려줘"라고 물으면, 그래프에서 경로와 단계별 실행 방법, 카운터, 흔한 실수를 찾아 답합니다.

**설치**

```bash
git clone https://github.com/hanwong/bjjgraph-mcp.git
cd bjjgraph-mcp
npm install
npm run fetch-data
claude mcp add bjjgraph --scope user -- node "$(pwd)/dist/src/index.js"
```

BJJGraph 데이터는 자주 갱신되니, 가끔 `npm run fetch-data`를 다시 실행하면 최신 데이터로 바뀝니다.

**꼭 알아 두세요**

- 이 저장소의 **코드**는 MIT 라이선스입니다.
- **BJJGraph 데이터**는 © Diogo Seca, PolyForm Noncommercial 1.0.0 라이선스이며 이 저장소에 **포함되어 있지 않습니다**. 각자 `npm run fetch-data`로 내려받으며, **비상업적 용도로만** 쓸 수 있습니다.
- BJJGraph 내용은 상당 부분 AI의 도움으로 만들어졌고, 확률은 작성자가 정한 **추정치**입니다(블랙벨트 검증 전). **공부 보조 자료로만** 쓰고, 정답으로 받아들이지 마세요.
