---
name: doc-with-mermaid
description: Author documentation in Markdown and use Mermaid diagrams for all architecture and design visuals. Use when writing architecture, design, or flow docs.
---

# Documentation with Mermaid

## Rule

All documentation is **Markdown**. Architecture and design visuals are **Mermaid** diagrams in the
Markdown (not ASCII art, not image files). Follow the `markdown-lint` skill as well.

## When to use which diagram

| Need                          | Mermaid diagram   |
| ----------------------------- | ----------------- |
| Services and how they connect | `flowchart`       |
| Requests and webhooks         | `sequenceDiagram` |
| Seat, hold and booking states | `stateDiagram-v2` |
| Tables                        | `erDiagram`       |

## Conventions

- One diagram per concept; readable over exhaustive.
- Label edges with the message (`hold A1`, `payment.failed`).
- Pair every diagram with a sentence or two of context.

## Syntax traps (these break rendering)

- **No `;` in sequence-diagram message text.** It ends the statement. Write `one TX: hold + notify`.
- **No `#` in message text**; write "number".
- **Brackets and braces in flowchart labels** need quotes: `A["stock {sku: 1}"]`.
- Check before committing: parse every block with the `mermaid` npm package under jsdom.

## Example

```mermaid
sequenceDiagram
  participant B as booking-service
  participant G as payment-gateway
  B->>G: create session
  G-->>B: payUrl
```
