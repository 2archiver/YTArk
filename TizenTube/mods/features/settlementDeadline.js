// Settle a unit of asynchronous work within a deadline.
//
// The deadline is a settlement deadline: it resolves even when the work never
// finishes, which can happen when a runtime lacks AbortController or a fetch
// ignores its signal. It never rejects. The timer is always cleared, and a late
// result or rejection from timed-out work is absorbed so it cannot surface as
// an unhandled rejection or mutate state after the caller has moved on.

/**
 * @returns {Promise<{timedOut: true} | {timedOut: false, value: any} | {timedOut: false, error: any}>}
 */
export async function settleWithin(work, timeoutMs) {
  let timer = null;
  const deadline = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ timedOut: true }), timeoutMs);
  });
  const settled = Promise.resolve()
    .then(() => work())
    .then(
      value => ({ timedOut: false, value }),
      error => ({ timedOut: false, error }),
    );
  try {
    return await Promise.race([settled, deadline]);
  } finally {
    clearTimeout(timer);
  }
}
