# Phase 1: Data Loading

Load experimental data, validate format and completeness, perform initial inspection to produce a clean dataset and data profile for subsequent analysis phases.

## Objective

- Read experimental data from supported formats (CSV, JSON, TensorBoard, pickle)
- Validate data completeness, consistency, and format correctness
- Detect outliers and missing values
- Generate a data profile summarizing dimensions, types, and quality
- Produce cleaned data ready for statistical analysis

## Step 1.1: Locate and Read Data Files

Identify all data files in the provided path:

```javascript
// Discover data files
const dataFiles = Glob(pattern=`${DATA_PATH}/**/*.{csv,json,pkl,tfevents}`);

// If single file provided
if (isFile(DATA_PATH)) {
  dataFiles = [DATA_PATH];
}

// Read each file based on format
for (const file of dataFiles) {
  const ext = getExtension(file);
  switch (ext) {
    case '.csv':
      // Read CSV with headers
      // Expect columns: run/seed, metric1, metric2, ...
      // Example: run,accuracy,f1_score,training_time
      break;
    case '.json':
      // Read structured JSON results
      // Expect: { model: string, runs: [{ metrics: {...} }] }
      break;
    case '.tfevents':
      // Parse TensorBoard event files
      // Extract scalar summaries (loss, accuracy per step)
      break;
    case '.pkl':
      // Load pickle objects (requires Python)
      break;
  }
}
```

**Expected CSV format**:
```csv
run,accuracy,f1_score,training_time
1,86.2,85.8,2.5
2,86.5,86.1,2.4
3,85.9,85.5,2.6
4,86.3,85.9,2.5
5,86.1,85.7,2.5
```

**Expected JSON format**:
```json
{
  "model": "our_method",
  "dataset": "IMDB",
  "runs": [
    { "seed": 42, "accuracy": 93.5, "f1": 92.8, "time_hours": 5.2 },
    { "seed": 123, "accuracy": 93.2, "f1": 92.5, "time_hours": 5.3 }
  ]
}
```

## Step 1.2: Data Validation

Perform systematic validation checks on loaded data:

### Completeness Check

```
For each dataset file:
  1. Count total rows/entries
  2. Check for missing values per column
     - If missing > 10%: FLAG as critical, recommend exclusion or imputation
     - If missing 1-10%: WARN, document in data profile
     - If missing 0%: PASS
  3. Verify expected columns exist
  4. Check that run/seed identifiers are unique
```

### Consistency Check

```
For each dataset file:
  1. Verify data types per column (numeric, string, etc.)
  2. Check value ranges are reasonable
     - Accuracy/F1: should be 0-100 or 0-1 (detect and normalize)
     - Time: should be positive
     - Loss: should be non-negative
  3. Check units consistency across files
     - All accuracy values in same scale (% vs fraction)
     - All time values in same unit (seconds vs hours)
  4. Verify number of runs is consistent across models
```

### Reproducibility Check

```
For each dataset file:
  1. Check if random seeds are recorded
  2. Check if version/environment info is available
  3. Check if hyperparameters are documented
  4. Note: these are informational, not blocking
```

## Step 1.3: Outlier Detection

Apply IQR method to detect potential outliers:

```
For each numeric metric column:
  Q1 = 25th percentile
  Q3 = 75th percentile
  IQR = Q3 - Q1
  Lower bound = Q1 - 1.5 * IQR
  Upper bound = Q3 + 1.5 * IQR

  Outliers = values outside [Lower bound, Upper bound]

  If outliers found:
    - Report: "Outlier detected in [metric] for [model]: value [X] (bounds: [L, U])"
    - Do NOT remove automatically
    - Flag for sensitivity analysis in Phase 2
```

## Step 1.4: Generate Data Profile

Compile validation results into a structured data profile:

```markdown
## Data Profile

### Overview
- **Files loaded**: N files
- **Models/Methods**: [list of model names]
- **Datasets**: [list of dataset names]
- **Metrics**: [list of metric columns]
- **Runs per model**: N (seeds: [list])

### Data Quality
- **Missing values**: [count per column or "None"]
- **Outliers detected**: [count and locations or "None"]
- **Format issues**: [list or "None"]

### Preliminary Statistics (per model, per metric)
| Model | Metric | N | Min | Max | Mean | SD |
|-------|--------|---|-----|-----|------|-----|
| ...   | ...    | . | ... | ... | ...  | ... |

### Validation Status
- Completeness: [PASS/WARN/FAIL]
- Consistency: [PASS/WARN/FAIL]
- Reproducibility info: [Available/Partial/Missing]
```

## Step 1.5: Prepare Cleaned Data

Structure the validated data for downstream phases:

```javascript
const cleanedData = {
  models: [
    {
      name: "model_name",
      datasets: [
        {
          name: "dataset_name",
          runs: N,
          seeds: [42, 123, ...],
          metrics: {
            accuracy: [86.2, 86.5, 85.9, ...],
            f1_score: [85.8, 86.1, 85.5, ...],
            training_time: [2.5, 2.4, 2.6, ...]
          }
        }
      ]
    }
  ],
  outlierFlags: [...],  // locations of detected outliers
  missingFlags: [...]   // locations of missing values
};

const dataProfile = {
  fileCount: N,
  modelNames: [...],
  datasetNames: [...],
  metricNames: [...],
  runsPerModel: N,
  validationStatus: { completeness: "PASS", consistency: "PASS", reproducibility: "Available" }
};
```

## Output

- **Variable**: `cleanedData` -- validated, structured experimental data
- **Variable**: `dataProfile` -- summary of data dimensions, quality, and validation status
- **update_plan**: Mark Phase 1 completed, Phase 2 in_progress

## Next Phase

Return to orchestrator, then auto-continue to [Phase 2: Statistical Analysis](02-statistical-analysis.md).
