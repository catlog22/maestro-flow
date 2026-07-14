# Phase 2: Rewrite & Polish

## Objective

Apply targeted rewrites to all flagged passages from Phase 1. Remove AI patterns while preserving meaning, then inject human voice and personality. This is the critical transformation phase.

<!-- COMPACT SENTINEL: Do not skip or abbreviate any step in this phase. Every flagged passage must be individually addressed. Bulk "apply all" shortcuts are not permitted. -->

## Execution

### Step 2.1: Apply Core Rules

For each flagged passage in `patternReport.sections[].flaggedPassages[]`, apply these rules in order:

**Rule 1: Cut filler phrases**
- Remove throat-clearing openers ("It is important to note that", "It is worth mentioning that")
- Remove emphasis crutches ("significantly", "notably", "remarkably")
- Remove hedging stacks ("could potentially possibly")
- If the sentence still makes sense without the phrase, cut it

**Rule 2: Break formulaic structures**
- Avoid binary contrasts ("not just X, but also Y" -> state Y directly)
- Avoid dramatic fragmentation ("It's not merely a song. It's a statement." -> state the point once)
- Collapse "despite X, Y continues to Z" into direct statements
- Break rule-of-three lists into prose or keep only the most relevant items

**Rule 3: Vary rhythm**
- If three consecutive sentences have similar length (within 20%), restructure
- Mix short declarative sentences (5-10 words) with longer compound ones
- Vary paragraph endings -- not every paragraph should end with a broad statement
- Avoid starting consecutive sentences with the same word or structure

**Rule 4: Trust readers**
- State facts directly without softening ("The policy failed" not "It could be argued that the policy may have fallen short")
- Remove "signaling", "highlighting", "underscoring" -- these tell readers what to think
- Cut "This is important because..." -- if it's important, the reader will see why
- Remove post-hoc justifications that explain why you just told the reader something

**Rule 5: Cut quotables**
- If a sentence sounds like it belongs on a motivational poster, rewrite it
- "The future looks bright" -> specific next steps
- "This represents a paradigm shift" -> what actually changed
- If you could imagine it in a press release, make it more specific

### Step 2.2: Language-Specific Rewrites

#### English Fixes

| AI Pattern | Fix |
|------------|-----|
| "serves as" / "stands as" | Use "is" |
| "boasts" / "features" / "offers" | Use "has" or "includes" |
| "Additionally" | Use "Also" or restructure to eliminate |
| "crucial" / "pivotal" / "vital" | Remove or use "important" if truly needed |
| "delve into" | Use "examine" or "look at" |
| "enhance" | Use "improve" or be specific about what changes |
| "landscape" (abstract) | Name the actual domain or remove |
| "tapestry" (abstract) | Describe the actual mixture |
| "testament to" | State the evidence directly |
| "vibrant" | Describe the actual quality |
| "nestled in" | Use "in" or "located in" |
| "garnered" | Use "received" or "got" |
| Em dashes (--) | Replace with commas, parentheses, or restructure into separate sentences |
| "It's not just X; it's Y" | State Y directly |
| "From X to Y" (false range) | List the actual topics covered |

#### Chinese Fixes

| AI Pattern | Fix |
|------------|-----|
| "此外" (Additionally) | "也" / "还" or restructure |
| "至关重要" (crucial) | "重要" or remove if context is clear |
| "深入探讨" (delve into) | "讨论" / "分析" |
| "充满活力" (vibrant) | Describe the actual quality |
| "格局" / "landscape" (abstract) | Name the specific domain |
| "作为……的证明/体现" | State the evidence directly |
| "值得注意的是" | Remove, state the fact directly |
| "不可磨灭的印记" | Be specific about the actual impact |
| "为……奠定基础" | State what was built and when |
| "坐落于" (nestled in) | "位于" or "在" |
| "令人叹为观止" (breathtaking) | Describe what is actually notable |
| "持久的" / "永恒的" | Remove or state the time span |
| "凸显/彰显了" | State the fact; let the reader judge significance |

### CHECKPOINT

Before proceeding to Step 2.3, verify:
- [ ] Every flagged passage from Phase 1 has been addressed
- [ ] No new AI patterns were introduced during rewriting
- [ ] LaTeX commands remain intact (run Step 2.4 check)
- [ ] Core meaning is preserved in every rewrite

If any check fails, return to the failing step before continuing.

### Step 2.3: Add Voice & Soul

This step is critical. Removing AI patterns is necessary but not sufficient. Text that has only had patterns removed often reads as flat and lifeless. The goal is to add humanity.

**Have opinions**
- React to facts, don't just report them
- State what is surprising, unusual, or counter-intuitive

| Before (flat) | After (with voice) |
|---|---|
| "The company grew 200% in two years." | "The company tripled in two years, an unusual pace even for the sector." |
| "This approach achieves state-of-the-art results on three benchmarks." | "This approach tops three benchmarks — though the margins on GLUE are razor-thin." |
| "该方法在三个数据集上优于基线。" | "该方法在三个数据集上均优于基线，其中在小样本场景下的提升尤为明显。" |

**Vary rhythm deliberately**
- After a long explanatory sentence, follow with something short
- Let paragraph rhythm reflect content — tense moments get shorter sentences

| Before (metronomic) | After (varied) |
|---|---|
| "The algorithm processes each node by traversing the adjacency list. It compares weights at each step. It then selects the minimum-cost edge." | "The algorithm processes each node by traversing the adjacency list, comparing weights, and selecting the minimum-cost edge at each step. This is slow." |
| "我们首先进行数据预处理。然后我们训练模型。最后我们评估性能。" | "数据预处理后直接进入训练。评估结果出人意料。" |

**Acknowledge complexity**
- Real humans have mixed feelings — avoid clean narratives where everything is positive
- It is fine to leave questions open

| Before (clean narrative) | After (honest complexity) |
|---|---|
| "The reform improved healthcare access, demonstrating the effectiveness of the policy." | "The reform improved access but created new bottlenecks — rural clinics gained funding yet lost staff to urban hospitals." |
| "该方法有效解决了这一长期存在的问题。" | "该方法缓解了主要瓶颈，但在极端分布偏移下仍存在退化现象。" |

**Use appropriate voice**
- In non-academic contexts: "I think", "I found", "In my experience"
- In academic contexts: "We observe", "Our analysis suggests", "We note that"
- Avoid passive voice when it hides the agent unnecessarily

| Before (passive/hidden) | After (active/clear) |
|---|---|
| "It was observed that the model failed to converge." | "We found the model failed to converge when batch size exceeded 256." |
| "实验结果表明了该方法的有效性。" | "实验结果表明该方法在低资源场景下尤为有效，但在数据充足时优势减弱。" |

**For academic context specifically**
- Maintain formal-but-natural tone
- Precision matters more than personality
- Voice comes through in word choice and analytical framing, not casual language
- Signal uncertainty honestly ("This suggests..." rather than "This proves...")
- Keep discipline-specific terminology

### Step 2.4: Preserve LaTeX

For .tex input, verify after all rewrites:

1. All `\cite{...}` commands are intact with correct keys
2. All `\ref{...}` and `\label{...}` pairs are preserved
3. Math environments (`$...$`, `\[...\]`, `\begin{equation}...`) are unchanged
4. Custom commands and macros are untouched
5. Figure/table environments and their captions are structurally intact
6. No LaTeX commands were accidentally modified during text rewrites

**Method**: Extract all LaTeX commands from original text, compare with rewritten text, flag any differences.

## Output

```
polishedText:
  sections:
    - name: <section identifier>
      originalText: "<original>"
      rewrittenText: "<rewritten>"
      changesApplied:
        - patternId: <id>
          original: "<flagged passage>"
          rewritten: "<new passage>"
          ruleApplied: "<rule name>"
      latexIntegrity: <pass|fail>
  checkpointStatus: <pass|fail>
  voiceAdded: <true|false>
```

## Next Phase

Pass `polishedText` to **Phase 3: Validate & Score** for re-scoring and comparison.
