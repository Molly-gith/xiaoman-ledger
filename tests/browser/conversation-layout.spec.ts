import { test, expect, type Page } from "@playwright/test";
import { expandEntryOptions, openLedger, openBills, returnHome } from "./ledger-helpers";
async function noHorizontalOverflow(page:Page) {
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
}
for(const size of [{width:390,height:844},{width:1440,height:1000},{width:320,height:760},{width:844,height:390}]) {
  test("entry controls remain reachable at "+size.width+"x"+size.height,async({page})=>{
    await page.setViewportSize(size);await openLedger(page);await noHorizontalOverflow(page);
    await page.getByRole("textbox",{name:"记账或问小满"}).fill("午饭35元");
    await page.getByRole("button",{name:"发送给小满"}).scrollIntoViewIfNeeded();
    await expect(page.getByRole("button",{name:"发送给小满"})).toBeInViewport();
    await page.getByRole("button",{name:"手动记一笔",exact:true}).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.locator(".app-content").first()).toHaveAttribute("inert","");
    await page.getByRole("button",{name:"收入",exact:true}).click();
    await page.locator('[name="amount"]').fill("8000");await expandEntryOptions(page);
    await page.locator('[name="note"]').fill("工资");
    const save=page.getByRole("button",{name:"记好了",exact:true});
    await save.scrollIntoViewIfNeeded();await expect(save).toBeInViewport();
    expect(await save.evaluate(element=>{
      const box=element.getBoundingClientRect(), hit=document.elementFromPoint(box.x+box.width/2,box.y+box.height/2);
      return !!hit&&(element===hit||element.contains(hit));
    })).toBe(true);
    await page.keyboard.press("Tab");
    expect(await page.evaluate(()=>!!document.activeElement?.closest('[role="dialog"]'))).toBe(true);
    await save.click();await expect(page.getByRole("dialog")).toHaveCount(0);
    await openBills(page);await noHorizontalOverflow(page);await returnHome(page);
    await page.screenshot({path:"test-results/everyday-home-"+size.width+"x"+size.height+".png",fullPage:true});
  });
}
test("simulated mobile keyboard viewport keeps income save visible and unobstructed",async({page})=>{
  await page.addInitScript(()=>{
    const viewport=new EventTarget();
    Object.assign(viewport,{height:window.innerHeight,offsetTop:0,scale:1});
    Object.defineProperty(window,"visualViewport",{configurable:true,value:viewport});
  });
  await openLedger(page);await page.getByRole("button",{name:"手动记一笔",exact:true}).click();
  await page.getByRole("button",{name:"收入",exact:true}).click();await expandEntryOptions(page);
  await page.locator('[name="amount"]').fill("8000");await page.locator('[name="note"]').fill("工资到账");
  await page.screenshot({path:"test-results/everyday-income-mobile.png"});
  await page.evaluate(()=>{
    Object.assign(window.visualViewport!,{height:410,offsetTop:0});
    window.visualViewport!.dispatchEvent(new Event("resize"));
  });
  const save=page.getByRole("button",{name:"记好了",exact:true});
  await expect.poll(async()=>{const box=await save.boundingBox();return box?box.y+box.height:1000;}).toBeLessThanOrEqual(410);
  expect(await save.evaluate(element=>{
    const box=element.getBoundingClientRect(),hit=document.elementFromPoint(box.x+box.width/2,box.y+box.height/2);
    return !!hit&&(element===hit||element.contains(hit));
  })).toBe(true);
  await page.screenshot({path:"test-results/everyday-income-keyboard-mobile.png"});
  await save.click();await expect(page.getByRole("dialog")).toHaveCount(0);
});
