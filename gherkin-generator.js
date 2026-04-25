// ============================================================
// gherkin-generator.js — Rule-Based Gherkin Generator
// Converts recorded action steps into proper Gherkin BDD syntax.
// Zero AI — purely deterministic rule-based transformation.
// ============================================================

'use strict';

/**
 * Main entry point.
 * @param {Array}  steps        - Array of recorded action objects
 * @param {string} featureName  - Feature block name
 * @param {string} scenarioName - Scenario block name
 * @param {string} [tags]       - Optional tags (e.g. "@smoke @regression")
 * @returns {string} Full Gherkin feature file text
 */
function generateGherkin(steps, featureName, scenarioName, tags = '') {
  if (!steps || steps.length === 0) {
    return `Feature: ${featureName}\n\n  Scenario: ${scenarioName}\n    # No steps recorded yet`;
  }

  const lines = [];

  // Tags
  if (tags && tags.trim()) {
    lines.push(tags.trim());
  }

  lines.push(`Feature: ${escapeGherkin(featureName)}`);
  lines.push('');

  // Docstring — optional context comment
  const firstNav = steps.find(s => s.type === 'navigate');
  if (firstNav) {
    lines.push(`  # URL: ${firstNav.url}`);
    lines.push(`  # Steps: ${steps.length}`);
    lines.push('');
  }

  lines.push(`  Scenario: ${escapeGherkin(scenarioName)}`);

  // Convert each step
  let prevKeyword = null;
  let stepIndex = 0;

  for (const step of steps) {
    const result = stepToGherkin(step, stepIndex, prevKeyword);
    if (!result) continue;

    lines.push(`    ${result.line}`);
    prevKeyword = result.keyword;
    stepIndex++;
  }

  // Add an empty Then at end if recording ended with When steps
  if (prevKeyword === 'When') {
    lines.push(`    Then I verify the page state`);
  }

  lines.push('');
  return lines.join('\n');
}

/**
 * Converts a single recorded action to a Gherkin step.
 * Returns { line, keyword } or null to skip.
 */
function stepToGherkin(step, index, prevKeyword) {
  const isFirst = index === 0;

  switch (step.type) {
    case 'navigate':
      return navigate(step, isFirst, prevKeyword);

    case 'click':
      return click(step, prevKeyword);

    case 'input':
      return input(step, prevKeyword);

    case 'select':
      return select(step, prevKeyword);

    case 'checkbox':
      return checkbox(step, prevKeyword);

    case 'radio':
      return radio(step, prevKeyword);

    case 'submit':
      return submit(step, prevKeyword);

    case 'file':
      return fileUpload(step, prevKeyword);

    case 'hotkey':
      return hotkey(step, prevKeyword);

    case 'assert':
      return assertion(step, prevKeyword);

    case 'scroll':
      return scroll(step, prevKeyword);

    default:
      return null;
  }
}

// ===========================================================
//  STEP CONVERTERS
// ===========================================================

function navigate(step, isFirst, prevKeyword) {
  const kw = isFirst || prevKeyword === null ? 'Given' : 'And';
  const url = step.url;

  // Try to make URL friendlier
  try {
    const parsed = new URL(url);
    const path = parsed.pathname;

    // Map common paths to friendly names
    if (path === '/' || path === '') {
      return { line: `${kw} I am on the home page`, keyword: kw };
    }
    if (path.includes('/login') || path.includes('/signin')) {
      return { line: `${kw} I am on the login page`, keyword: kw };
    }
    if (path.includes('/register') || path.includes('/signup')) {
      return { line: `${kw} I am on the registration page`, keyword: kw };
    }
    if (path.includes('/dashboard')) {
      return { line: `${kw} I am on the dashboard page`, keyword: kw };
    }
    if (path.includes('/profile')) {
      return { line: `${kw} I am on the profile page`, keyword: kw };
    }
    if (path.includes('/settings')) {
      return { line: `${kw} I am on the settings page`, keyword: kw };
    }
    if (path.includes('/checkout')) {
      return { line: `${kw} I am on the checkout page`, keyword: kw };
    }
    if (path.includes('/cart')) {
      return { line: `${kw} I am on the shopping cart page`, keyword: kw };
    }
    if (path.includes('/search')) {
      return { line: `${kw} I am on the search page`, keyword: kw };
    }
  } catch (e) {}

  return { line: `${kw} I navigate to "${url}"`, keyword: kw };
}

function click(step, prevKeyword) {
  const kw = resolveKeyword(prevKeyword, 'When');
  const label = q(step.label);

  switch (step.elementType) {
    case 'button':
      return { line: `${kw} I click the "${label}" button`, keyword: kw };
    case 'link':
      return { line: `${kw} I click the "${label}" link`, keyword: kw };
    case 'checkbox':
      // Checkbox click → handled by 'checkbox' type event better
      return { line: `${kw} I click the "${label}" checkbox`, keyword: kw };
    case 'radio':
      return { line: `${kw} I select the "${label}" radio option`, keyword: kw };
    case 'tab':
      return { line: `${kw} I click the "${label}" tab`, keyword: kw };
    case 'menuitem':
      return { line: `${kw} I click the "${label}" menu item`, keyword: kw };
    case 'clickable':
      return { line: `${kw} I click on "${label}"`, keyword: kw };
    default:
      return { line: `${kw} I click on "${label}"`, keyword: kw };
  }
}

function input(step, prevKeyword) {
  const kw = resolveKeyword(prevKeyword, 'When');
  const label = q(step.label);
  const value = q(step.value);

  if (step.inputType === 'email') {
    return { line: `${kw} I enter "${value}" in the "${label}" email field`, keyword: kw };
  }
  if (step.inputType === 'password') {
    return { line: `${kw} I enter a password in the "${label}" field`, keyword: kw };
  }
  if (step.inputType === 'number' || step.inputType === 'tel') {
    return { line: `${kw} I enter "${value}" in the "${label}" field`, keyword: kw };
  }
  if (step.inputType === 'search') {
    return { line: `${kw} I search for "${value}" in the "${label}" field`, keyword: kw };
  }
  if (step.inputType === 'date') {
    return { line: `${kw} I set the "${label}" date to "${value}"`, keyword: kw };
  }
  if (step.inputType === 'time') {
    return { line: `${kw} I set the "${label}" time to "${value}"`, keyword: kw };
  }
  if (step.inputType === 'url') {
    return { line: `${kw} I enter "${value}" in the "${label}" URL field`, keyword: kw };
  }

  // textarea
  if (step.value && step.value.length > 50) {
    return { line: `${kw} I fill in the "${label}" field with text`, keyword: kw };
  }

  return { line: `${kw} I type "${value}" in the "${label}" field`, keyword: kw };
}

function select(step, prevKeyword) {
  const kw = resolveKeyword(prevKeyword, 'When');
  const label = q(step.label);
  const value = q(step.value);
  return { line: `${kw} I select "${value}" from the "${label}" dropdown`, keyword: kw };
}

function checkbox(step, prevKeyword) {
  const kw = resolveKeyword(prevKeyword, 'When');
  const label = q(step.label);
  const action = step.checked ? 'check' : 'uncheck';
  return { line: `${kw} I ${action} the "${label}" checkbox`, keyword: kw };
}

function radio(step, prevKeyword) {
  const kw = resolveKeyword(prevKeyword, 'When');
  const label = q(step.label || step.value);
  return { line: `${kw} I select the "${label}" option`, keyword: kw };
}

function submit(step, prevKeyword) {
  const kw = resolveKeyword(prevKeyword, 'When');
  if (!step.label || step.label === 'form') {
    return { line: `${kw} I submit the form`, keyword: kw };
  }
  return { line: `${kw} I submit the "${q(step.label)}" form`, keyword: kw };
}

function fileUpload(step, prevKeyword) {
  const kw = resolveKeyword(prevKeyword, 'When');
  const label = q(step.label);
  const value = q(step.value);
  return { line: `${kw} I upload "${value}" via the "${label}" file input`, keyword: kw };
}

function hotkey(step, prevKeyword) {
  const kw = resolveKeyword(prevKeyword, 'When');
  return { line: `${kw} I press "${step.label}"`, keyword: kw };
}

function assertion(step, prevKeyword) {
  const kw = 'Then';
  const text = q(step.value);
  return { line: `${kw} I should see "${text}"`, keyword: kw };
}

function scroll(step, prevKeyword) {
  const kw = resolveKeyword(prevKeyword, 'When');
  const dir = step.direction || 'down';
  return { line: `${kw} I scroll ${dir} the page`, keyword: kw };
}

// ===========================================================
//  UTILITIES
// ===========================================================

/** Pick correct Gherkin keyword based on flow */
function resolveKeyword(prevKeyword, defaultKw) {
  if (!prevKeyword) return defaultKw;
  if (prevKeyword === defaultKw) return 'And';
  return defaultKw;
}

/** Escape special chars in Gherkin step values */
function q(str) {
  if (!str) return '';
  return String(str).replace(/"/g, '\\"').slice(0, 80);
}

/** Escape feature/scenario names */
function escapeGherkin(str) {
  if (!str) return 'Untitled';
  return String(str).replace(/[|#@]/g, '').trim() || 'Untitled';
}

/**
 * Get step icon for UI display
 */
function getStepIcon(step) {
  const icons = {
    navigate:  '🌐',
    click:     step?.elementType === 'link' ? '🔗' : step?.elementType === 'button' ? '🖱️' : '👆',
    input:     step?.inputType === 'password' ? '🔒' : '⌨️',
    select:    '📋',
    checkbox:  '☑️',
    radio:     '🔘',
    submit:    '📤',
    file:      '📎',
    hotkey:    '⌨️',
    assert:    '✅',
    scroll:    '↕️',
    hotkey:    '⚡'
  };
  return icons[step?.type] || '▶️';
}

/**
 * Get a short human-readable summary for the steps list UI
 */
function getStepSummary(step) {
  switch (step.type) {
    case 'navigate':
      try {
        return `Navigate → ${new URL(step.url).pathname || '/'}`;
      } catch {
        return `Navigate → ${step.url}`;
      }
    case 'click':
      return `Click "${step.label}"`;
    case 'input':
      if (step.inputType === 'password') return `Type password in "${step.label}"`;
      return `Type "${step.value}" → "${step.label}"`;
    case 'select':
      return `Select "${step.value}" from "${step.label}"`;
    case 'checkbox':
      return `${step.checked ? 'Check' : 'Uncheck'} "${step.label}"`;
    case 'radio':
      return `Select option "${step.label}"`;
    case 'submit':
      return `Submit form "${step.label}"`;
    case 'file':
      return `Upload "${step.value}" to "${step.label}"`;
    case 'hotkey':
      return `Press ${step.label}`;
    case 'assert':
      return `Verify: "${step.value}"`;
    case 'scroll':
      return `Scroll ${step.direction || 'down'}`;
    default:
      return step.label || step.type;
  }
}

/**
 * Merge consecutive duplicate navigate steps (dedup)
 */
function deduplicateSteps(steps) {
  const result = [];
  for (let i = 0; i < steps.length; i++) {
    const current = steps[i];
    const prev = result[result.length - 1];

    // Skip duplicate navigations
    if (current.type === 'navigate' && prev && prev.type === 'navigate' && prev.url === current.url) {
      continue;
    }

    // Skip click immediately followed by input on same element (input wins)
    if (
      current.type === 'input' &&
      prev &&
      prev.type === 'click' &&
      prev.label === current.label
    ) {
      result.pop(); // remove the click, keep input
    }

    result.push(current);
  }
  return result;
}

// Export for popup.js usage
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { generateGherkin, getStepIcon, getStepSummary, deduplicateSteps, stepToGherkin };
}
