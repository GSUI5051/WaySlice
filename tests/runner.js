/**
 * Minimal dependency-free test harness.
 * Suites register cases; runAll() executes them and renders a report.
 */

/** @type {{name:string, cases:{name:string, fn:Function}[]}[]} */
export const suites = [];
let currentSuite = null;

export function suite(name, fn) {
  currentSuite = { name, cases: [] };
  suites.push(currentSuite);
  fn();
  currentSuite = null;
}

export function test(name, fn) {
  currentSuite.cases.push({ name, fn });
}

/* Assertions ---------------------------------------------------------------- */

export function assert(condition, message = 'assertion failed') {
  if (!condition) throw new Error(message);
}

assert.equal = (actual, expected, message) => {
  if (actual !== expected) {
    throw new Error(`${message || 'equal'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
};
assert.deepEqual = (actual, expected, message) => {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) {
    throw new Error(`${message || 'deepEqual'}: expected ${b}, got ${a}`);
  }
};
assert.closeTo = (actual, expected, epsilon, message) => {
  if (!(Math.abs(actual - expected) <= epsilon)) {
    throw new Error(`${message || 'closeTo'}: expected ${expected} ±${epsilon}, got ${actual}`);
  }
};
assert.isNull = (actual, message) => {
  if (actual !== null) throw new Error(`${message || 'isNull'}: expected null, got ${JSON.stringify(actual)}`);
};
assert.truthy = (actual, message) => {
  if (!actual) throw new Error(`${message || 'truthy'}: got ${JSON.stringify(actual)}`);
};
assert.throws = (fn, message) => {
  try {
    fn();
  } catch (err) {
    return err;
  }
  throw new Error(message || 'expected function to throw');
};

assert.throwsAsync = async (fn, message) => {
  try {
    await fn();
  } catch (err) {
    return err;
  }
  throw new Error(message || 'expected promise to reject');
};

/* Runner ---------------------------------------------------------------- */

export async function runAll(container) {
  const summary = { total: 0, passed: 0, failed: 0 };
  const root = document.createElement('div');
  root.className = 'test-report';

  for (const s of suites) {
    const section = document.createElement('section');
    const h2 = document.createElement('h2');
    h2.textContent = s.name;
    section.appendChild(h2);

    for (const c of s.cases) {
      summary.total++;
      const line = document.createElement('div');
      line.className = 'test-case';
      try {
        await c.fn();
        summary.passed++;
        line.classList.add('pass');
        line.textContent = `✓ ${c.name}`;
      } catch (err) {
        summary.failed++;
        line.classList.add('fail');
        line.textContent = `✗ ${c.name} — ${err.message}`;
      }
      section.appendChild(line);
    }
    root.appendChild(section);
  }

  const head = document.createElement('p');
  head.className = 'test-summary';
  head.textContent = `${summary.passed}/${summary.total} passed` + (summary.failed ? ` — ${summary.failed} FAILED` : '');
  container.prepend(head);
  container.appendChild(root);
  console.log(`[tests] ${summary.passed}/${summary.total} passed`);
  return summary;
}
