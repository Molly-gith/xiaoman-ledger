import { test, expect, type Page } from "@playwright/test";
import { exportLedger, openBills, openLedger, returnHome } from "./ledger-helpers";
type VoiceHarness = {
  lang:string; interimResults:boolean; continuous:boolean; stopped:number; aborted:number;
  emit:(text:string,final?:boolean)=>void; end:()=>void; fail:(error:string)=>void; late:(text:string)=>void;
};
const input=(page:Page)=>page.getByRole("textbox",{name:"记账或问小满",exact:true});
async function mockSpeech(page:Page) {
  await page.addInitScript(()=>{
    type ResultEvent={results:Array<Array<{transcript:string}>&{isFinal:boolean}>};
    class Recognition {
      lang="";interimResults=true;continuous=true;stopped=0;aborted=0;
      onresult:((event:ResultEvent)=>void)|null=null;
      onerror:((event:{error:string})=>void)|null=null;
      onend:(()=>void)|null=null;
      savedResult:((event:ResultEvent)=>void)|null=null;
      savedEnd:(()=>void)|null=null;
      constructor(){(window as unknown as {testSpeech:Recognition}).testSpeech=this;}
      start(){this.savedResult=this.onresult;this.savedEnd=this.onend;}
      stop(){this.stopped++;}
      abort(){this.aborted++;}
      emit(text:string,final=true){this.onresult?.({results:[Object.assign([{transcript:text}],{isFinal:final})]});}
      end(){this.onend?.();}
      fail(error:string){this.onerror?.({error});}
      late(text:string){this.savedResult?.({results:[Object.assign([{transcript:text}],{isFinal:true})]});this.savedEnd?.();}
    }
    Object.defineProperty(window,"SpeechRecognition",{configurable:true,value:Recognition});
  });
}
test("voice retains more than 100 characters, waits for final end and never auto-submits",async({page})=>{
  let calls=0;await page.route("**/api/ai/**",route=>{calls++;return route.abort();});await mockSpeech(page);await openLedger(page);
  await input(page).fill("原有文字");
  await page.getByRole("button",{name:"语音输入",exact:true}).click();
  expect(await page.evaluate(()=>{const r=(window as unknown as {testSpeech:VoiceHarness}).testSpeech;return [r.lang,r.interimResults,r.continuous];})).toEqual(["zh-CN",false,false]);
  const transcript="今天午饭35元，".repeat(15)+"工资到账8000元";
  await page.evaluate(text=>(window as unknown as {testSpeech:VoiceHarness}).testSpeech.emit(text),transcript);
  await expect(input(page)).toHaveValue("原有文字");
  await page.getByRole("button",{name:"停止录音",exact:true}).click();
  await expect(page.getByRole("button",{name:"正在转成文字",exact:true})).toBeDisabled();
  await page.evaluate(()=>(window as unknown as {testSpeech:VoiceHarness}).testSpeech.end());
  await expect(input(page)).toHaveValue("原有文字 "+transcript);
  await expect(page.locator(".voice-input-message")).toContainText("检查后再发送");
  expect(calls).toBe(0);expect((await exportLedger(page)).state.transactions).toEqual([]);
});
test("voice cancellation discards recognized and late text while keeping the existing input",async({page})=>{
  await mockSpeech(page);await openLedger(page);await input(page).fill("保留这句话");
  await page.getByRole("button",{name:"语音输入",exact:true}).click();
  await page.evaluate(()=>(window as unknown as {testSpeech:VoiceHarness}).testSpeech.emit("不应该被写入"));
  await page.getByRole("button",{name:"取消录音",exact:true}).click();
  await page.evaluate(()=>(window as unknown as {testSpeech:VoiceHarness}).testSpeech.late("迟到识别"));
  await expect(input(page)).toHaveValue("保留这句话");
  await expect(page.locator(".voice-input-message")).toContainText("已取消");
  expect(await page.evaluate(()=>(window as unknown as {testSpeech:VoiceHarness}).testSpeech.aborted)).toBe(1);
});
test("permission denial retains text and unsupported browsers offer keyboard input",async({page})=>{
  await mockSpeech(page);await openLedger(page);await input(page).fill("工资到账");
  await page.getByRole("button",{name:"语音输入",exact:true}).click();
  await page.evaluate(()=>(window as unknown as {testSpeech:VoiceHarness}).testSpeech.fail("not-allowed"));
  await expect(page.locator(".voice-input-message")).toContainText("麦克风未获授权");
  await expect(input(page)).toHaveValue("工资到账");
  await page.evaluate(()=>{
    Object.defineProperty(window,"SpeechRecognition",{configurable:true,value:undefined});
    Object.defineProperty(window,"webkitSpeechRecognition",{configurable:true,value:undefined});
  });
  await page.getByRole("button",{name:"语音输入",exact:true}).click();
  await expect(page.locator(".voice-input-message")).toContainText("浏览器不支持网页语音");
  await expect(input(page)).toHaveValue("工资到账");
});
test("interim-only and timed-out voice sessions never replace input",async({page})=>{
  await mockSpeech(page);await openLedger(page);await input(page).fill("原来的内容");
  await page.getByRole("button",{name:"语音输入",exact:true}).click();
  await page.evaluate(()=>{const r=(window as unknown as {testSpeech:VoiceHarness}).testSpeech;r.emit("暂时结果",false);r.end();});
  await expect(page.locator(".voice-input-message")).toContainText("没有收到文字");
  await expect(input(page)).toHaveValue("原来的内容");
  await page.getByRole("button",{name:"语音输入",exact:true}).click();
  await page.getByRole("button",{name:"停止录音",exact:true}).click();
  await page.clock.fastForward(12001);
  await expect(page.locator(".voice-input-message")).toContainText("语音转换超时");
  await expect(input(page)).toHaveValue("原来的内容");
});
test("leaving home cancels voice and late callbacks cannot write into the hidden composer",async({page})=>{
  await mockSpeech(page);await openLedger(page);await input(page).fill("继续保留");
  await page.getByRole("button",{name:"语音输入",exact:true}).click();
  await openBills(page);
  await page.evaluate(()=>(window as unknown as {testSpeech:VoiceHarness}).testSpeech.late("不能填入"));
  await returnHome(page);await expect(input(page)).toHaveValue("继续保留");
});
test("voice text requires explicit send and confirmation, then saves with voice provenance",async({page})=>{
  test.skip(process.env.AI_BROWSER_TEST!=="1","AI mock build required");
  let calls=0;await mockSpeech(page);
  await page.route("https://xiaoman-ai-test.example/api/ai/assistant",route=>{
    calls++;return route.fulfill({json:{status:"transactions",modelVersion:"test",workflowVersion:"test",drafts:[{
      type:"expense",amount:35,category:"餐饮",occurred_at:"2026-09-15",note:"午饭",nature_suggestion:"消费",confidence:0.9,ambiguous:false,
    }]}});
  });
  await openLedger(page);await page.getByRole("button",{name:"语音输入",exact:true}).click();
  await page.evaluate(()=>{const r=(window as unknown as {testSpeech:VoiceHarness}).testSpeech;r.emit("今天午饭35元");r.end();});
  await expect(input(page)).toHaveValue("今天午饭35元");expect(calls).toBe(0);
  await page.getByRole("button",{name:"发送给小满"}).click();
  await expect(page.getByRole("region",{name:"待保存账目"})).toBeVisible();
  expect((await exportLedger(page)).state.transactions).toEqual([]);
  await page.getByRole("button",{name:"保存这笔",exact:true}).click();
  await expect(page.getByRole("region",{name:"待保存账目"})).toHaveCount(0);
  expect((await exportLedger(page)).state.transactions[0]).toMatchObject({amount:35,source:"voice",cycleId:null});expect(calls).toBe(1);
});

test("opening read-only history stops recording and ignores delayed speech",async({page})=>{
  await mockSpeech(page);await openLedger(page);
  await input(page).fill("本月支出多少");await page.getByRole("button",{name:"发送给小满",exact:true}).click();
  await expect(page.getByTestId("ai-answer")).toBeVisible();
  await input(page).fill("回来接着聊");await page.getByRole("button",{name:"语音输入",exact:true}).click();
  await page.getByRole("button",{name:"查看历史对话",exact:true}).click();
  expect(await page.evaluate(()=>(window as unknown as {testSpeech:VoiceHarness}).testSpeech.aborted)).toBe(1);
  await page.evaluate(()=>(window as unknown as {testSpeech:VoiceHarness}).testSpeech.late("旧录音不填入"));
  await expect(input(page)).toBeHidden();
  await page.getByRole("button",{name:"返回当前对话",exact:true}).click();
  await expect(input(page)).toHaveValue("回来接着聊");
});
