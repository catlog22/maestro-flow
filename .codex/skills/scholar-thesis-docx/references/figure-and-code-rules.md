# Figure and Code Rules

## 1. Mermaid Usage Rules

1. Generate Mermaid only when the user needs an architecture diagram, flow
   chart, E-R diagram, state diagram, or similar thesis figure and has provided
   real source material.
2. Base the diagram on actual code, schema definitions, API docs, project docs,
   or thesis text from the user.
3. Do not guess entities, fields, relationships, module boundaries, or call
   chains when the evidence is incomplete.
4. Ask for the missing material before generating the figure.

## 2. Thesis Diagram Style

1. Keep the structure clean and avoid decorative nodes.
2. Use neutral academic terminology.
3. Avoid chatty labels and extra explanatory filler.
4. Keep directions and relationships faithful to the real system.
5. For E-R diagrams, emphasize entities, keys, core attributes, and cardinality.
6. For architecture diagrams, emphasize layers, modules, and interactions.

## 3. Code Listing Rules

1. Prefer LaTeX-oriented code typesetting when the thesis includes code.
2. Keep only the parts needed for the thesis argument.
3. Use real identifiers from the user's code or design.
4. Do not fabricate code or pseudocode for padding.

## 4. Output Rules

- Every diagram and code listing must be traceable to user-provided material.
- If any fact is uncertain, ask for evidence instead of guessing.
