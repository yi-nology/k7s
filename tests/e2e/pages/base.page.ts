import { type Page, type Locator, expect } from '@playwright/test';

/**
 * 基础页面对象模型
 * 
 * 提供通用的页面操作方法，所有页面对象都继承此类
 */
export class BasePage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  /**
   * 等待页面加载完成
   */
  async waitForLoad() {
    await this.page.waitForLoadState('networkidle');
  }

  /**
   * 点击包含指定文本的元素
   */
  async clickByText(text: string) {
    await this.page.getByText(text, { exact: true }).click();
  }

  /**
   * 点击包含指定文本的按钮
   */
  async clickButton(text: string) {
    await this.page.getByRole('button', { name: text }).click();
  }

  /**
   * 等待元素出现
   */
  async waitForSelector(selector: string, timeout = 10000) {
    await this.page.waitForSelector(selector, { timeout });
  }

  /**
   * 获取元素文本
   */
  async getText(selector: string): Promise<string> {
    return await this.page.locator(selector).innerText();
  }

  /**
   * 检查元素是否可见
   */
  async isVisible(selector: string): Promise<boolean> {
    return await this.page.locator(selector).isVisible();
  }

  /**
   * 等待并点击元素
   */
  async waitAndClick(selector: string, timeout = 10000) {
    await this.page.waitForSelector(selector, { timeout });
    await this.page.locator(selector).click();
  }

  /**
   * 输入文本
   */
  async fill(selector: string, text: string) {
    await this.page.locator(selector).fill(text);
  }

  /**
   * 清空输入框
   */
  async clear(selector: string) {
    await this.page.locator(selector).clear();
  }

  /**
   * 按下键盘按键
   */
  async pressKey(key: string) {
    await this.page.keyboard.press(key);
  }

  /**
   * 等待指定时间
   */
  async wait(ms: number) {
    await this.page.waitForTimeout(ms);
  }

  /**
   * 截图
   */
  async screenshot(name: string) {
    await this.page.screenshot({ path: `test-results/screenshots/${name}.png` });
  }

  /**
   * 获取页面标题
   */
  async getTitle(): Promise<string> {
    return await this.page.title();
  }

  /**
   * 获取当前 URL
   */
  getUrl(): string {
    return this.page.url();
  }

  /**
   * 导航到指定 URL
   */
  async goto(url: string) {
    await this.page.goto(url);
  }

  /**
   * 刷新页面
   */
  async reload() {
    await this.page.reload();
  }

  /**
   * 返回上一页
   */
  async goBack() {
    await this.page.goBack();
  }

  /**
   * 前进到下一页
   */
  async goForward() {
    await this.page.goForward();
  }

  /**
   * 获取所有匹配的元素
   */
  locator(selector: string): Locator {
    return this.page.locator(selector);
  }

  /**
   * 获取匹配文本的元素
   */
  getByText(text: string, options?: { exact?: boolean }): Locator {
    return this.page.getByText(text, options);
  }

  /**
   * 获取匹配角色的元素
   */
  getByRole(role: string, options?: { name?: string }): Locator {
    return this.page.getByRole(role as any, options);
  }

  /**
   * 获取匹配标签的元素
   */
  getByLabel(text: string): Locator {
    return this.page.getByLabel(text);
  }

  /**
   * 获取匹配占位符的元素
   */
  getByPlaceholder(text: string): Locator {
    return this.page.getByPlaceholder(text);
  }

  /**
   * 获取匹配测试 ID 的元素
   */
  getByTestId(testId: string): Locator {
    return this.page.getByTestId(testId);
  }

  /**
   * 断言元素包含文本
   */
  async expectText(selector: string, text: string) {
    await expect(this.page.locator(selector)).toContainText(text);
  }

  /**
   * 断言元素可见
   */
  async expectVisible(selector: string) {
    await expect(this.page.locator(selector)).toBeVisible();
  }

  /**
   * 断言元素不可见
   */
  async expectHidden(selector: string) {
    await expect(this.page.locator(selector)).toBeHidden();
  }

  /**
   * 断言元素已禁用
   */
  async expectDisabled(selector: string) {
    await expect(this.page.locator(selector)).toBeDisabled();
  }

  /**
   * 断言元素已启用
   */
  async expectEnabled(selector: string) {
    await expect(this.page.locator(selector)).toBeEnabled();
  }

  /**
   * 断言页面标题
   */
  async expectTitle(title: string) {
    await expect(this.page).toHaveTitle(title);
  }

  /**
   * 断言 URL
   */
  async expectUrl(url: string | RegExp) {
    await expect(this.page).toHaveURL(url);
  }
}
