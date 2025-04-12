/**
 * Monitoring Utilities
 *
 * This module provides monitoring and metrics collection for the application.
 */

/**
 * Metric types for the application
 */
export enum MetricType {
  // Redis metrics
  REDIS_TRANSACTION_DURATION = 'redis_transaction_duration',
  REDIS_TRANSACTION_SUCCESS = 'redis_transaction_success',
  REDIS_TRANSACTION_FAILURE = 'redis_transaction_failure',
  REDIS_OPERATION_DURATION = 'redis_operation_duration',
  REDIS_OPERATION_SUCCESS = 'redis_operation_success',
  REDIS_OPERATION_FAILURE = 'redis_operation_failure',

  // WebRTC metrics
  WEBRTC_CONNECTION_ATTEMPT = 'webrtc_connection_attempt',
  WEBRTC_CONNECTION_SUCCESS = 'webrtc_connection_success',
  WEBRTC_CONNECTION_FAILURE = 'webrtc_connection_failure',
  WEBRTC_ICE_GATHERING_DURATION = 'webrtc_ice_gathering_duration',
  WEBRTC_OFFER_CREATION_DURATION = 'webrtc_offer_creation_duration',
  WEBRTC_ANSWER_CREATION_DURATION = 'webrtc_answer_creation_duration',
  WEBRTC_OFFER_VALIDATION_SUCCESS = 'webrtc_offer_validation_success',
  WEBRTC_OFFER_VALIDATION_FAILURE = 'webrtc_offer_validation_failure',
  WEBRTC_OFFER_REPAIR_SUCCESS = 'webrtc_offer_repair_success',
  WEBRTC_OFFER_REPAIR_FAILURE = 'webrtc_offer_repair_failure',

  // API metrics
  API_REQUEST_ATTEMPT = 'api_request_attempt',
  API_REQUEST_DURATION = 'api_request_duration',
  API_REQUEST_SUCCESS = 'api_request_success',
  API_REQUEST_FAILURE = 'api_request_failure',

  // Tour metrics
  TOUR_CREATION = 'tour_creation',
  TOUR_CREATION_DURATION = 'tour_creation_duration',
  TOUR_CREATION_FAILURE = 'tour_creation_failure',
  TOUR_END = 'tour_end',
  TOUR_END_DURATION = 'tour_end_duration',
  TOUR_END_FAILURE = 'tour_end_failure',
  TOUR_ATTENDEE_JOIN = 'tour_attendee_join',
  TOUR_ATTENDEE_JOIN_DURATION = 'tour_attendee_join_duration',
  TOUR_ATTENDEE_JOIN_FAILURE = 'tour_attendee_join_failure',
  TOUR_ATTENDEE_LEAVE = 'tour_attendee_leave',
  TOUR_LANGUAGE_ADD = 'tour_language_add',
  TOUR_LANGUAGE_ADD_DURATION = 'tour_language_add_duration',
  TOUR_LANGUAGE_ADD_FAILURE = 'tour_language_add_failure',
  TOUR_LANGUAGE_REMOVE = 'tour_language_remove',
  TOUR_LANGUAGE_REMOVE_DURATION = 'tour_language_remove_duration',
  TOUR_LANGUAGE_REMOVE_FAILURE = 'tour_language_remove_failure',

  // Error metrics
  ERROR_COUNT = 'error_count',
  ERROR_TYPE_COUNT = 'error_type_count',

  // Performance metrics
  MEMORY_USAGE = 'memory_usage',
  CPU_USAGE = 'cpu_usage'
}

/**
 * Metric data interface
 */
export interface MetricData {
  type: MetricType;
  value: number;
  timestamp: number;
  labels?: Record<string, string>;
}

// In-memory storage for metrics (in a production app, this would be sent to a monitoring service)
const metrics: MetricData[] = [];

/**
 * Record a metric
 *
 * @param type The type of metric
 * @param value The value of the metric
 * @param labels Optional labels for the metric
 */
export function recordMetric(type: MetricType, value: number, labels?: Record<string, string>): void {
  const metric: MetricData = {
    type,
    value,
    timestamp: Date.now(),
    labels
  };

  metrics.push(metric);

  // In a production app, we would send this to a monitoring service
  // For now, we'll just log it in development
  if (process.env.NODE_ENV === 'development') {
    console.log(`[METRIC] ${type}: ${value}`, labels);
  }

  // Limit the size of the in-memory metrics array
  if (metrics.length > 1000) {
    metrics.shift();
  }
}

/**
 * Get metrics for a specific type
 *
 * @param type The type of metric to get
 * @param timeRange Optional time range in milliseconds (default: last hour)
 * @returns Array of metrics
 */
export function getMetrics(type: MetricType, timeRange: number = 3600000): MetricData[] {
  const now = Date.now();
  const cutoff = now - timeRange;

  return metrics.filter(metric =>
    metric.type === type && metric.timestamp >= cutoff
  );
}

/**
 * Calculate the average value for a specific metric type
 *
 * @param type The type of metric to average
 * @param timeRange Optional time range in milliseconds (default: last hour)
 * @returns The average value or null if no metrics found
 */
export function getAverageMetric(type: MetricType, timeRange: number = 3600000): number | null {
  const relevantMetrics = getMetrics(type, timeRange);

  if (relevantMetrics.length === 0) {
    return null;
  }

  const sum = relevantMetrics.reduce((acc, metric) => acc + metric.value, 0);
  return sum / relevantMetrics.length;
}

/**
 * Time a function execution and record the duration as a metric
 *
 * @param fn The function to time
 * @param metricType The type of metric to record
 * @param labels Optional labels for the metric
 * @returns The result of the function
 */
export async function timeAsync<T>(
  fn: () => Promise<T>,
  metricType: MetricType,
  labels?: Record<string, string>
): Promise<T> {
  const startTime = Date.now();

  try {
    const result = await fn();
    const duration = Date.now() - startTime;

    recordMetric(metricType, duration, labels);

    return result;
  } catch (error) {
    const duration = Date.now() - startTime;

    // Record the duration even if there was an error
    recordMetric(metricType, duration, {
      ...labels,
      error: 'true',
      errorMessage: error instanceof Error ? error.message : String(error)
    });

    throw error;
  }
}

/**
 * Get the current memory usage
 *
 * @returns Memory usage in MB
 */
export function getMemoryUsage(): number {
  const memoryUsage = process.memoryUsage();
  return Math.round(memoryUsage.heapUsed / 1024 / 1024 * 100) / 100;
}

/**
 * Record the current memory usage
 */
export function recordMemoryUsage(): void {
  recordMetric(MetricType.MEMORY_USAGE, getMemoryUsage());
}

/**
 * Start periodic monitoring
 *
 * @param intervalMs The interval in milliseconds (default: 60000 - 1 minute)
 * @returns A function to stop monitoring
 */
export function startPeriodicMonitoring(intervalMs: number = 60000): () => void {
  // Record initial metrics
  recordMemoryUsage();

  // Set up interval for periodic monitoring
  const intervalId = setInterval(() => {
    recordMemoryUsage();
  }, intervalMs);

  // Return a function to stop monitoring
  return () => {
    clearInterval(intervalId);
  };
}
