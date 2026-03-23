// UI helpers for ADK Web (localhost:8000) interaction
import { Page } from '@playwright/test';

export async function newSession(page: Page) {
  await page.locator('.toolbar-new-sesison').click();
  await page.waitForTimeout(1500);
}

export async function sendMessage(page: Page, message: string) {
  const cardsBefore = await page.locator('.mat-mdc-card.mdc-card.message-card').count();

  await page.locator('#mat-input-0').click();
  await page.locator('#mat-input-0').type(message);
  await page.locator('#mat-input-0').press('Enter');

  // Wait for 2 new message-cards (user + AI) and for the AI card to contain complete JSON
  await page.waitForFunction(
    (count) => {
      const cards = document.querySelectorAll('.mat-mdc-card.mdc-card.message-card');
      if (cards.length < count + 2) return false;
      const lastText = (cards[cards.length - 1].textContent ?? '').replace(/```json|```/g, '').trim();
      try {
        JSON.parse(lastText);
        return true;
      } catch {
        return false;
      }
    },
    cardsBefore,
    { timeout: 30_000 },
  );

  const cards = page.locator('.mat-mdc-card.mdc-card.message-card');
  const lastCard = cards.last();
  const text = (await lastCard.textContent()) ?? '';
  const cleaned = text.replace(/```json|```/g, '').trim();
  return JSON.parse(cleaned);
}
