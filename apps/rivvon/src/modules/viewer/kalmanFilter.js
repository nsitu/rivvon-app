export class KalmanFilter1D {
    constructor({ processNoise = 8, measurementNoise = 25 } = {}) {
        this.processNoise = processNoise;
        this.measurementNoise = measurementNoise;
        this.reset();
    }

    reset() {
        this.estimate = null;
        this.covariance = 1;
    }

    update(measurement, measurementNoise = this.measurementNoise) {
        if (!Number.isFinite(measurement)) {
            return this.estimate ?? 0;
        }

        const safeMeasurementNoise = Math.max(0.001, measurementNoise);

        if (this.estimate === null) {
            this.estimate = measurement;
            this.covariance = safeMeasurementNoise;
            return this.estimate;
        }

        this.covariance += this.processNoise;
        const gain = this.covariance / (this.covariance + safeMeasurementNoise);

        this.estimate += gain * (measurement - this.estimate);
        this.covariance = (1 - gain) * this.covariance;

        return this.estimate;
    }
}

export class KalmanFilter2D {
    constructor(options = {}) {
        this.filterX = new KalmanFilter1D(options);
        this.filterY = new KalmanFilter1D(options);
        this.measurementNoise = options.measurementNoise ?? 25;
    }

    reset() {
        this.filterX.reset();
        this.filterY.reset();
    }

    update(point, measurementNoise = this.measurementNoise) {
        return {
            x: this.filterX.update(point.x, measurementNoise),
            y: this.filterY.update(point.y, measurementNoise)
        };
    }
}