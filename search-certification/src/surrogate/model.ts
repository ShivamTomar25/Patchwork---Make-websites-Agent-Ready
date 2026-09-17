export type Prediction = {
  mean: number;
  uncertainty: number;
  covariance: number[][];
  surrogate: "bayesian-ridge-graph-aware-v1";
};

export class BayesianRidgeSurrogate {
  readonly name = "bayesian-ridge-graph-aware-v1" as const;
  private weights: number[] = [];
  private residualVariance = 0.25;
  private featureMeans: number[] = [];

  fit(features: number[][], targets: number[]) {
    if (features.length === 0) {
      this.weights = [];
      this.residualVariance = 0.25;
      return;
    }
    const width = features[0]?.length || 0;
    const design = features.map((row) => [1, ...row]);
    this.featureMeans = meanColumns(features);
    const xtx = zeros(width + 1, width + 1);
    const xty = new Array(width + 1).fill(0);
    for (let row = 0; row < design.length; row += 1) {
      for (let i = 0; i < width + 1; i += 1) {
        xty[i] += (design[row]?.[i] || 0) * (targets[row] || 0);
        for (let j = 0; j < width + 1; j += 1) xtx[i]![j] += (design[row]?.[i] || 0) * (design[row]?.[j] || 0);
      }
    }
    for (let i = 0; i < width + 1; i += 1) xtx[i]![i] += 1;
    this.weights = solveLinearSystem(xtx, xty);
    const residuals = features.map((row, index) => (targets[index] || 0) - this.rawPredict(row));
    this.residualVariance = Math.max(0.02, residuals.reduce((sum, value) => sum + value * value, 0) / Math.max(1, residuals.length));
  }

  predict(feature: number[]): Prediction {
    const mean = this.weights.length ? this.rawPredict(feature) : 0.5;
    const distance = euclidean(feature, this.featureMeans);
    const uncertainty = Math.min(1, Math.sqrt(this.residualVariance + distance / Math.max(1, feature.length)));
    return {
      mean,
      uncertainty,
      covariance: [[uncertainty * uncertainty]],
      surrogate: this.name
    };
  }

  private rawPredict(feature: number[]) {
    return (this.weights[0] || 0) + feature.reduce((sum, value, index) => sum + value * (this.weights[index + 1] || 0), 0);
  }
}

function zeros(rows: number, columns: number) {
  return Array.from({ length: rows }, () => new Array(columns).fill(0));
}

function meanColumns(rows: number[][]) {
  const width = rows[0]?.length || 0;
  return Array.from({ length: width }, (_, column) => rows.reduce((sum, row) => sum + (row[column] || 0), 0) / Math.max(1, rows.length));
}

function euclidean(left: number[], right: number[]) {
  if (right.length === 0) return 1;
  return Math.sqrt(left.reduce((sum, value, index) => sum + (value - (right[index] || 0)) ** 2, 0));
}

function solveLinearSystem(matrix: number[][], vector: number[]) {
  const n = vector.length;
  const augmented = matrix.map((row, index) => [...row, vector[index] || 0]);
  for (let pivot = 0; pivot < n; pivot += 1) {
    let best = pivot;
    for (let row = pivot + 1; row < n; row += 1) {
      if (Math.abs(augmented[row]?.[pivot] || 0) > Math.abs(augmented[best]?.[pivot] || 0)) best = row;
    }
    [augmented[pivot], augmented[best]] = [augmented[best]!, augmented[pivot]!];
    const divisor = augmented[pivot]?.[pivot] || 1;
    for (let column = pivot; column <= n; column += 1) augmented[pivot]![column] = (augmented[pivot]?.[column] || 0) / divisor;
    for (let row = 0; row < n; row += 1) {
      if (row === pivot) continue;
      const factor = augmented[row]?.[pivot] || 0;
      for (let column = pivot; column <= n; column += 1) augmented[row]![column] = (augmented[row]?.[column] || 0) - factor * (augmented[pivot]?.[column] || 0);
    }
  }
  return augmented.map((row) => row[n] || 0);
}
