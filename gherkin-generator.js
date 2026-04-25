// gherkin-generator.js — Multi-format Test Generator v2
'use strict';

// ═══════════════════════════════════════════════════════════
//  GHERKIN OUTPUT
// ═══════════════════════════════════════════════════════════

function generateGherkin(steps, featureName, scenarioName, tags = '') {
  if (!steps || steps.length === 0) {
    return `Feature: ${featureName}\n\n  Scenario: ${scenarioName}\n    # No steps recorded yet`;
  }
  const lines = [];
  if (tags?.trim()) lines.push(tags.trim());
  lines.push(`Feature: ${escapeGherkin(featureName)}`);
  lines.push('');
  const firstNav = steps.find(s => s.type === 'navigate');
  if (firstNav) {
    lines.push(`  # URL: ${firstNav.url}`);
    lines.push(`  # Steps: ${steps.length}`);
    lines.push('');
  }
  lines.push(`  Scenario: ${escapeGherkin(scenarioName)}`);
  let prevKeyword = null, idx = 0;
  for (const step of steps) {
    const r = stepToGherkin(step, idx, prevKeyword);
    if (!r) continue;
    lines.push(`    ${r.line}`);
    prevKeyword = r.keyword; idx++;
  }
  if (prevKeyword === 'When') lines.push(`    Then I verify the page state`);
  lines.push('');
  return lines.join('\n');
}

function stepToGherkin(step, index, prevKeyword) {
  const isFirst = index === 0;
  switch (step.type) {
    case 'navigate':  return navigate(step, isFirst, prevKeyword);
    case 'click':     return click(step, prevKeyword);
    case 'input':     return input(step, prevKeyword);
    case 'select':    return select(step, prevKeyword);
    case 'checkbox':  return checkbox(step, prevKeyword);
    case 'radio':     return radio(step, prevKeyword);
    case 'submit':    return submit(step, prevKeyword);
    case 'file':      return fileUpload(step, prevKeyword);
    case 'hotkey':    return hotkey(step, prevKeyword);
    case 'assert':    return assertion(step);
    case 'scroll':    return scroll(step, prevKeyword);
    case 'dragdrop':  return dragdrop(step, prevKeyword);
    case 'paste':     return paste(step, prevKeyword);
    default:          return null;
  }
}

function navigate(step, isFirst, prev) {
  const kw = isFirst || !prev ? 'Given' : 'And';
  try {
    const p = new URL(step.url).pathname;
    const map = [
      ['/login','/signin'],    'I am on the login page',
      ['/register','/signup'], 'I am on the registration page',
      ['/dashboard'],          'I am on the dashboard page',
      ['/profile'],            'I am on the profile page',
      ['/settings'],           'I am on the settings page',
      ['/checkout'],           'I am on the checkout page',
      ['/cart'],               'I am on the shopping cart page',
      ['/search'],             'I am on the search page',
      ['/'],                   'I am on the home page',
    ];
    for (let i = 0; i < map.length; i += 2) {
      if (map[i].some(seg => p.includes(seg) || p === seg)) return { line: `${kw} ${map[i+1]}`, keyword: kw };
    }
  } catch(_) {}
  return { line: `${kw} I navigate to "${step.url}"`, keyword: kw };
}

function click(step, prev) {
  const kw = resolveKw(prev, 'When'); const lb = q(step.label);
  const map = { button:'button', link:'link', tab:'tab', menuitem:'menu item', radio:'radio option' };
  if (map[step.elementType]) return { line: `${kw} I click the "${lb}" ${map[step.elementType]}`, keyword: kw };
  if (step.elementType === 'checkbox') return { line: `${kw} I click the "${lb}" checkbox`, keyword: kw };
  return { line: `${kw} I click on "${lb}"`, keyword: kw };
}

function input(step, prev) {
  const kw = resolveKw(prev, 'When'); const lb = q(step.label); const val = q(step.value);
  const map = {
    email:    `${kw} I enter "${val}" in the "${lb}" email field`,
    password: `${kw} I enter a password in the "${lb}" field`,
    search:   `${kw} I search for "${val}" in the "${lb}" field`,
    date:     `${kw} I set the "${lb}" date to "${val}"`,
    time:     `${kw} I set the "${lb}" time to "${val}"`,
    number:   `${kw} I enter "${val}" in the "${lb}" field`,
    tel:      `${kw} I enter "${val}" in the "${lb}" field`,
    url:      `${kw} I enter "${val}" in the "${lb}" URL field`,
  };
  const line = map[step.inputType] || (step.value?.length > 50
    ? `${kw} I fill in the "${lb}" field with text`
    : `${kw} I type "${val}" in the "${lb}" field`);
  return { line, keyword: kw };
}

function select(step, prev) {
  const kw = resolveKw(prev, 'When');
  return { line: `${kw} I select "${q(step.value)}" from the "${q(step.label)}" dropdown`, keyword: kw };
}
function checkbox(step, prev) {
  const kw = resolveKw(prev, 'When');
  return { line: `${kw} I ${step.checked ? 'check' : 'uncheck'} the "${q(step.label)}" checkbox`, keyword: kw };
}
function radio(step, prev) {
  const kw = resolveKw(prev, 'When');
  return { line: `${kw} I select the "${q(step.label || step.value)}" option`, keyword: kw };
}
function submit(step, prev) {
  const kw = resolveKw(prev, 'When');
  return { line: !step.label || step.label === 'form' ? `${kw} I submit the form` : `${kw} I submit the "${q(step.label)}" form`, keyword: kw };
}
function fileUpload(step, prev) {
  const kw = resolveKw(prev, 'When');
  return { line: `${kw} I upload "${q(step.value)}" via the "${q(step.label)}" file input`, keyword: kw };
}
function hotkey(step, prev) {
  const kw = resolveKw(prev, 'When');
  return { line: `${kw} I press "${step.label}"`, keyword: kw };
}
function assertion(step) {
  if (step.gherkinOverride) return { line: step.gherkinOverride.replace(/^    /, ''), keyword: 'Then' };
  return { line: `Then I should see "${q(step.value)}"`, keyword: 'Then' };
}
function scroll(step, prev) {
  const kw = resolveKw(prev, 'When');
  const pct = step.scrollPercent != null ? ` (${step.scrollPercent}% down)` : '';
  return { line: `${kw} I scroll ${step.direction || 'down'} the page${pct}`, keyword: kw };
}
function dragdrop(step, prev) {
  const kw = resolveKw(prev, 'When');
  return { line: `${kw} I drag "${q(step.label)}" and drop it onto "${q(step.value)}"`, keyword: kw };
}
function paste(step, prev) {
  const kw = resolveKw(prev, 'When');
  return { line: `${kw} I paste "${q(step.value)}" into the "${q(step.label)}" field`, keyword: kw };
}

// ═══════════════════════════════════════════════════════════
//  PLAYWRIGHT OUTPUT
// ═══════════════════════════════════════════════════════════

function generatePlaywright(steps, scenarioName) {
  const lines = [
    `import { test, expect } from '@playwright/test';`,
    ``,
    `test('${escapeJs(scenarioName)}', async ({ page }) => {`,
  ];
  for (const step of steps) {
    const line = stepToPlaywright(step);
    if (line) lines.push(`  ${line}`);
  }
  lines.push(`});`);
  return lines.join('\n');
}

function stepToPlaywright(step) {
  switch (step.type) {
    case 'navigate':
      return `await page.goto('${step.url}');`;
    case 'click':
      return `await page.getByRole('${step.elementType === 'button' ? 'button' : step.elementType === 'link' ? 'link' : 'button'}', { name: '${escapeJs(step.label)}' }).click();`;
    case 'input':
      if (step.inputType === 'password') return `await page.getByLabel('${escapeJs(step.label)}').fill('YOUR_PASSWORD');`;
      return `await page.getByLabel('${escapeJs(step.label)}').fill('${escapeJs(step.value)}');`;
    case 'select':
      return `await page.getByLabel('${escapeJs(step.label)}').selectOption('${escapeJs(step.value)}');`;
    case 'checkbox':
      return step.checked
        ? `await page.getByLabel('${escapeJs(step.label)}').check();`
        : `await page.getByLabel('${escapeJs(step.label)}').uncheck();`;
    case 'submit':
      return `await page.locator('form${step.label && step.label !== 'form' ? `[name="${escapeJs(step.label)}"]` : ''}').press('Enter');`;
    case 'file':
      return `await page.getByLabel('${escapeJs(step.label)}').setInputFiles('${escapeJs(step.value)}');`;
    case 'hotkey':
      return `await page.keyboard.press('${step.label.replace('Ctrl', 'Control').replace('+', '+')}');`;
    case 'assert':
      return `await expect(page.getByText('${escapeJs(step.value)}')).toBeVisible();`;
    case 'scroll':
      return `await page.mouse.wheel(0, ${step.direction === 'up' ? -500 : 500});`;
    case 'dragdrop':
      return `await page.locator('text=${escapeJs(step.label)}').dragTo(page.locator('text=${escapeJs(step.value)}'));`;
    default: return null;
  }
}

// ═══════════════════════════════════════════════════════════
//  CYPRESS OUTPUT
// ═══════════════════════════════════════════════════════════

function generateCypress(steps, scenarioName) {
  const lines = [
    `describe('${escapeJs(scenarioName)}', () => {`,
    `  it('should complete the user journey', () => {`,
  ];
  for (const step of steps) {
    const line = stepToCypress(step);
    if (line) lines.push(`    ${line}`);
  }
  lines.push(`  });`);
  lines.push(`});`);
  return lines.join('\n');
}

function stepToCypress(step) {
  switch (step.type) {
    case 'navigate':
      return `cy.visit('${step.url}');`;
    case 'click':
      return `cy.contains('${escapeJs(step.label)}').click();`;
    case 'input':
      if (step.inputType === 'password') return `cy.get('[type="password"]').type('YOUR_PASSWORD');`;
      return `cy.get('[placeholder="${escapeJs(step.label)}"], [aria-label="${escapeJs(step.label)}"]').type('${escapeJs(step.value)}');`;
    case 'select':
      return `cy.get('select').select('${escapeJs(step.value)}');`;
    case 'checkbox':
      return step.checked
        ? `cy.get('[type="checkbox"]').check();`
        : `cy.get('[type="checkbox"]').uncheck();`;
    case 'submit':
      return `cy.get('form').submit();`;
    case 'file':
      return `cy.get('[type="file"]').attachFile('${escapeJs(step.value)}');`;
    case 'hotkey':
      return `cy.get('body').type('{ctrl}${step.label.split('+')[1]?.toLowerCase() || 's'}');`;
    case 'assert':
      return `cy.contains('${escapeJs(step.value)}').should('be.visible');`;
    case 'scroll':
      return `cy.scrollTo('${step.direction === 'up' ? 'top' : 'bottom'}');`;
    default: return null;
  }
}

// ═══════════════════════════════════════════════════════════
//  SELENIUM (PYTHON) OUTPUT
// ═══════════════════════════════════════════════════════════

function generateSelenium(steps, scenarioName) {
  const lines = [
    `import unittest`,
    `from selenium import webdriver`,
    `from selenium.webdriver.common.by import By`,
    `from selenium.webdriver.support.ui import Select, WebDriverWait`,
    `from selenium.webdriver.support import expected_conditions as EC`,
    `from selenium.webdriver.common.keys import Keys`,
    ``,
    `class ${toPascalCase(scenarioName)}Test(unittest.TestCase):`,
    `    def setUp(self):`,
    `        self.driver = webdriver.Chrome()`,
    `        self.driver.implicitly_wait(10)`,
    `        self.wait = WebDriverWait(self.driver, 10)`,
    ``,
    `    def test_scenario(self):`,
    `        driver = self.driver`,
  ];
  for (const step of steps) {
    const line = stepToSelenium(step);
    if (line) lines.push(`        ${line}`);
  }
  lines.push(``);
  lines.push(`    def tearDown(self):`);
  lines.push(`        self.driver.quit()`);
  lines.push(``);
  lines.push(`if __name__ == '__main__':`);
  lines.push(`    unittest.main()`);
  return lines.join('\n');
}

function stepToSelenium(step) {
  switch (step.type) {
    case 'navigate':
      return `driver.get('${step.url}')`;
    case 'click':
      return `driver.find_element(By.XPATH, '//*[text()="${escapeXpath(step.label)}"]').click()`;
    case 'input':
      if (step.inputType === 'password') return `driver.find_element(By.CSS_SELECTOR, '[type="password"]').send_keys('YOUR_PASSWORD')`;
      return `driver.find_element(By.XPATH, '//*[@placeholder="${escapeXpath(step.label)}" or @aria-label="${escapeXpath(step.label)}"]').send_keys('${escapeXpath(step.value)}')`;
    case 'select':
      return `Select(driver.find_element(By.XPATH, './/select')).select_by_visible_text('${escapeXpath(step.value)}')`;
    case 'checkbox':
      return `checkbox = driver.find_element(By.XPATH, './/input[@type="checkbox"]')\nif checkbox.is_selected() != ${step.checked}: checkbox.click()`;
    case 'submit':
      return `driver.find_element(By.TAG_NAME, 'form').submit()`;
    case 'assert':
      return `self.assertIn('${escapeXpath(step.value)}', driver.page_source)`;
    case 'hotkey':
      return `driver.find_element(By.TAG_NAME, 'body').send_keys(Keys.CONTROL, '${step.label.split('+')[1]?.toLowerCase() || 's'}')`;
    default: return `# ${step.type}: ${step.label || ''}`;
  }
}

// ═══════════════════════════════════════════════════════════
//  JSON EXPORT
// ═══════════════════════════════════════════════════════════

function generateJSON(steps, featureName, scenarioName, tags) {
  const cleaned = steps.map(s => { const c = {...s}; delete c.screenshot; return c; });
  return JSON.stringify({ featureName, scenarioName, tags, steps: cleaned, generatedAt: new Date().toISOString() }, null, 2);
}

// ═══════════════════════════════════════════════════════════
//  UI HELPERS
// ═══════════════════════════════════════════════════════════

function getStepIcon(step) {
  const m = { navigate: '🌐', input: '⌨️', select: '📋', checkbox: '☑️',
               radio: '🔘', submit: '📤', file: '📎', hotkey: '⚡',
               assert: '✅', scroll: '↕️', dragdrop: '↔️', paste: '📋' };
  if (step?.type === 'click') {
    return step.elementType === 'link' ? '🔗' : step.elementType === 'button' ? '🖱️' : '👆';
  }
  if (step?.type === 'input' && step.inputType === 'password') return '🔒';
  return m[step?.type] || '▶️';
}

function getStepSummary(step) {
  switch (step.type) {
    case 'navigate':  try { return `Navigate → ${new URL(step.url).pathname || '/'}`; } catch { return `Navigate → ${step.url}`; }
    case 'click':     return `Click "${step.label}"`;
    case 'input':     return step.inputType === 'password' ? `Type password in "${step.label}"` : `Type "${step.value}" → "${step.label}"`;
    case 'select':    return `Select "${step.value}" from "${step.label}"`;
    case 'checkbox':  return `${step.checked ? 'Check' : 'Uncheck'} "${step.label}"`;
    case 'radio':     return `Select option "${step.label}"`;
    case 'submit':    return `Submit form "${step.label}"`;
    case 'file':      return `Upload "${step.value}" to "${step.label}"`;
    case 'hotkey':    return `Press ${step.label}`;
    case 'assert':    return `Verify: "${step.value}"`;
    case 'scroll':    return `Scroll ${step.direction || 'down'}${step.scrollPercent != null ? ` (${step.scrollPercent}%)` : ''}`;
    case 'dragdrop':  return `Drag "${step.label}" → "${step.value}"`;
    case 'paste':     return `Paste "${step.value}" into "${step.label}"`;
    default:          return step.label || step.type;
  }
}

function deduplicateSteps(steps) {
  const result = [];
  for (let i = 0; i < steps.length; i++) {
    const cur  = steps[i];
    const prev = result[result.length - 1];
    if (cur.type === 'navigate' && prev?.type === 'navigate' && prev.url === cur.url) continue;
    if (cur.type === 'input' && prev?.type === 'click' && prev.label === cur.label) result.pop();
    result.push(cur);
  }
  return result;
}

// ── Utilities ────────────────────────────────────────────
function resolveKw(prev, def) { return !prev ? def : prev === def ? 'And' : def; }
function q(s) { return s ? String(s).replace(/"/g, '\\"').slice(0, 80) : ''; }
function escapeGherkin(s) { return s ? String(s).replace(/[|#@]/g, '').trim() || 'Untitled' : 'Untitled'; }
function escapeJs(s) { return s ? String(s).replace(/'/g, "\\'").replace(/\n/g, ' ') : ''; }
function escapeXpath(s) { return s ? String(s).replace(/"/g, '\\"') : ''; }
function toPascalCase(s) { return s.replace(/(?:^|[\s_-])(\w)/g, (_, c) => c.toUpperCase()).replace(/[^a-zA-Z0-9]/g, ''); }

// Detect dynamic/variable values (UUID, numeric IDs, timestamps)
function detectVariables(steps) {
  const uuidRe  = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  const numIdRe = /(?<![a-z])\d{4,}(?![a-z])/i;
  const suggestions = [];
  steps.forEach((s, i) => {
    const val = s.value || '';
    if (uuidRe.test(val)) suggestions.push({ index: i, type: 'UUID', value: val });
    if (numIdRe.test(val)) suggestions.push({ index: i, type: 'ID', value: val });
  });
  return suggestions;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { generateGherkin, generatePlaywright, generateCypress, generateSelenium, generateJSON,
    getStepIcon, getStepSummary, deduplicateSteps, stepToGherkin, detectVariables };
}
