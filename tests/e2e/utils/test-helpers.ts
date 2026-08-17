import { type Page, expect } from '@playwright/test';

/**
 * E2E 测试工具函数
 */

/**
 * 等待应用加载完成
 */
export async function waitForAppLoad(page: Page) {
  // 等待页面加载
  await page.waitForLoadState('networkidle');
  
  // 等待侧边栏出现（表示应用已加载）
  await page.locator('[data-testid="sidebar"]').waitFor({ state: 'visible', timeout: 30000 });
  
  // 等待表格出现
  await page.locator('[data-testid="resource-table"]').waitFor({ state: 'visible', timeout: 30000 });
}

/**
 * 等待并获取 Toast 消息
 */
export async function waitForToast(page: Page, type: 'success' | 'error' | 'warning' | 'info' = 'success') {
  const toast = page.locator(`[data-testid="toast-${type}"]`);
  await toast.waitFor({ state: 'visible', timeout: 10000 });
  return await toast.innerText();
}

/**
 * 关闭 Toast 消息
 */
export async function dismissToast(page: Page) {
  const dismissButton = page.locator('[data-testid="toast-dismiss"]');
  if (await dismissButton.isVisible()) {
    await dismissButton.click();
  }
}

/**
 * 等待加载状态消失
 */
export async function waitForLoading(page: Page) {
  const loading = page.locator('[data-testid="loading"]');
  await loading.waitFor({ state: 'hidden', timeout: 30000 }).catch(() => {});
}

/**
 * 等待错误状态消失
 */
export async function waitForError(page: Page) {
  const error = page.locator('[data-testid="error"]');
  await error.waitFor({ state: 'hidden', timeout: 30000 }).catch(() => {});
}

/**
 * 截图并保存
 */
export async function takeScreenshot(page: Page, name: string) {
  await page.screenshot({ 
    path: `test-results/screenshots/${name}.png`,
    fullPage: true 
  });
}

/**
 * 获取页面性能指标
 */
export async function getPerformanceMetrics(page: Page) {
  return await page.evaluate(() => {
    const perf = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
    return {
      domContentLoaded: perf.domContentLoadedEventEnd - perf.domContentLoadedEventStart,
      load: perf.loadEventEnd - perf.loadEventStart,
      domInteractive: perf.domInteractive - perf.startTime,
      firstPaint: performance.getEntriesByName('first-paint')[0]?.startTime || 0,
      firstContentfulPaint: performance.getEntriesByName('first-contentful-paint')[0]?.startTime || 0,
    };
  });
}

/**
 * 模拟网络延迟
 */
export async function simulateNetworkDelay(page: Page, delay: number) {
  await page.route('**/*', async (route) => {
    await new Promise(resolve => setTimeout(resolve, delay));
    await route.continue();
  });
}

/**
 * 模拟网络错误
 */
export async function simulateNetworkError(page: Page, urlPattern: string) {
  await page.route(urlPattern, (route) => {
    route.abort('failed');
  });
}

/**
 * 模拟 API 响应
 */
export async function mockApiResponse(page: Page, urlPattern: string, response: any) {
  await page.route(urlPattern, (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(response),
    });
  });
}

/**
 * 清除所有 Mock
 */
export async function clearMocks(page: Page) {
  await page.unrouteAll();
}

/**
 * 获取本地存储数据
 */
export async function getLocalStorage(page: Page, key: string): Promise<string | null> {
  return await page.evaluate((key) => localStorage.getItem(key), key);
}

/**
 * 设置本地存储数据
 */
export async function setLocalStorage(page: Page, key: string, value: string) {
  await page.evaluate(([key, value]) => localStorage.setItem(key, value), [key, value]);
}

/**
 * 清除本地存储
 */
export async function clearLocalStorage(page: Page) {
  await page.evaluate(() => localStorage.clear());
}

/**
 * 获取会话存储数据
 */
export async function getSessionStorage(page: Page, key: string): Promise<string | null> {
  return await page.evaluate((key) => sessionStorage.getItem(key), key);
}

/**
 * 设置会话存储数据
 */
export async function setSessionStorage(page: Page, key: string, value: string) {
  await page.evaluate(([key, value]) => sessionStorage.setItem(key, value), [key, value]);
}

/**
 * 清除会话存储
 */
export async function clearSessionStorage(page: Page) {
  await page.evaluate(() => sessionStorage.clear());
}

/**
 * 等待指定时间
 */
export async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 重试操作
 */
export async function retry<T>(
  fn: () => Promise<T>,
  options: { maxRetries?: number; delay?: number; backoff?: number } = {}
): Promise<T> {
  const { maxRetries = 3, delay = 1000, backoff = 2 } = options;
  
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      await sleep(delay * Math.pow(backoff, i));
    }
  }
  
  throw new Error('Max retries exceeded');
}

/**
 * 生成随机字符串
 */
export function randomString(length: number = 8): string {
  return Math.random().toString(36).substring(2, 2 + length);
}

/**
 * 生成随机数字
 */
export function randomNumber(min: number = 0, max: number = 100): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * 生成随机布尔值
 */
export function randomBoolean(): boolean {
  return Math.random() > 0.5;
}

/**
 * 格式化日期
 */
export function formatDate(date: Date): string {
  return date.toISOString().replace('T', ' ').substring(0, 19);
}

/**
 * 等待元素文本变化
 */
export async function waitForTextChange(
  page: Page,
  selector: string,
  initialText: string,
  timeout: number = 10000
): Promise<string> {
  const element = page.locator(selector);
  await expect(element).not.toHaveText(initialText, { timeout });
  return await element.innerText();
}

/**
 * 等待元素属性变化
 */
export async function waitForAttributeChange(
  page: Page,
  selector: string,
  attribute: string,
  initialValue: string,
  timeout: number = 10000
): Promise<string> {
  const element = page.locator(selector);
  await expect(element).not.toHaveAttribute(attribute, initialValue, { timeout });
  return await element.getAttribute(attribute) || '';
}

/**
 * 滚动到元素可见
 */
export async function scrollToElement(page: Page, selector: string) {
  const element = page.locator(selector);
  await element.scrollIntoViewIfNeeded();
}

/**
 * 获取元素边界框
 */
export async function getBoundingBox(page: Page, selector: string) {
  const element = page.locator(selector);
  return await element.boundingBox();
}

/**
 * 模拟键盘快捷键
 */
export async function pressShortcut(page: Page, shortcut: string) {
  await page.keyboard.press(shortcut);
}

/**
 * 模拟鼠标悬停
 */
export async function hover(page: Page, selector: string) {
  const element = page.locator(selector);
  await element.hover();
}

/**
 * 模拟鼠标右键点击
 */
export async function rightClick(page: Page, selector: string) {
  const element = page.locator(selector);
  await element.click({ button: 'right' });
}

/**
 * 模拟鼠标双击
 */
export async function doubleClick(page: Page, selector: string) {
  const element = page.locator(selector);
  await element.dblclick();
}

/**
 * 拖放元素
 */
export async function dragAndDrop(page: Page, sourceSelector: string, targetSelector: string) {
  const source = page.locator(sourceSelector);
  const target = page.locator(targetSelector);
  await source.dragTo(target);
}

/**
 * 上传文件
 */
export async function uploadFile(page: Page, selector: string, filePath: string) {
  const element = page.locator(selector);
  await element.setInputFiles(filePath);
}

/**
 * 下载文件
 */
export async function downloadFile(page: Page, selector: string): Promise<string> {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator(selector).click(),
  ]);
  
  const path = await download.path();
  return path || '';
}

/**
 * 处理对话框
 */
export async function handleDialog(page: Page, accept: boolean, text?: string) {
  page.on('dialog', async (dialog) => {
    if (accept) {
      if (text) {
        await dialog.accept(text);
      } else {
        await dialog.accept();
      }
    } else {
      await dialog.dismiss();
    }
  });
}

/**
 * 获取控制台日志
 */
export async function getConsoleLogs(page: Page): Promise<string[]> {
  const logs: string[] = [];
  page.on('console', (msg) => {
    logs.push(msg.text());
  });
  return logs;
}

/**
 * 获取网络请求
 */
export async function getNetworkRequests(page: Page, urlPattern?: string): Promise<string[]> {
  const requests: string[] = [];
  page.on('request', (request) => {
    if (!urlPattern || request.url().includes(urlPattern)) {
      requests.push(request.url());
    }
  });
  return requests;
}

/**
 * 等待网络请求完成
 */
export async function waitForNetworkIdle(page: Page, timeout: number = 5000) {
  await page.waitForLoadState('networkidle', { timeout });
}
