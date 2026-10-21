import dealItem from "./dealItem"
import { showToast } from "./core/toast"

const MAX_ANSWERS = 300
const BTN_CLASS = "zhb-copy-all"
const LABEL = "复制本页全部回答为 Markdown"

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))
const answerItems = () => Array.from(document.querySelectorAll(".AnswerItem")) as HTMLElement[]

// 问题页：/question/123 或 /question/123/answers/updated；单个回答页不加
const isQuestionListPage = () => /^\/question\/\d+(\/answers\/\w+)?\/?$/.test(location.pathname)

async function loadAllAnswers(onProgress: (n: number) => void) {
    let stable = 0
    while (stable < 3) {
        const before = answerItems().length
        if (before >= MAX_ANSWERS) break
        // 已在底部时再 scrollTo 不会产生 scroll 事件，知乎就不会加载下一批；先上移一点再到底，并补发事件
        window.scrollBy(0, -800)
        await sleep(100)
        window.scrollTo(0, document.documentElement.scrollHeight)
        window.dispatchEvent(new Event("scroll"))
        await sleep(1500)
        const after = answerItems().length
        stable = after === before ? stable + 1 : 0
        onProgress(after)
    }
}

async function expandAll() {
    for (const item of answerItems()) {
        item.querySelectorAll(".ContentItem-more, .ContentItem-expandButton").forEach((b: HTMLElement) => b.click())
    }
    await sleep(600)
}

// 批量复制时临时关闭「元信息」「评论」，避免每条回答都带 frontmatter 或去抓评论
async function withoutFmAndComments<T>(fn: () => Promise<T>): Promise<T> {
    let fm: any, cm: any
    try {
        // @ts-ignore
        fm = GM_getValue("copy_save_fm"); cm = GM_getValue("copy_save_cm")
        // @ts-ignore
        GM_setValue("copy_save_fm", false); GM_setValue("copy_save_cm", false)
    } catch (e) { console.warn(e) }
    try {
        return await fn()
    } finally {
        try {
            // @ts-ignore
            GM_setValue("copy_save_fm", fm); GM_setValue("copy_save_cm", cm)
        } catch (e) { console.warn(e) }
    }
}

async function collect(title: string, onProgress: (done: number, total: number) => void) {
    const items = answerItems()
    const parts: string[] = []
    await withoutFmAndComments(async () => {
        for (let i = 0; i < items.length; i++) {
            onProgress(i, items.length)
            const item = items[i]
            const rich = item.querySelector(".RichText") as HTMLElement | null
            if (!rich) continue
            try {
                const res = await dealItem(rich, "copy")
                if (!res || !res.textString) continue
                const body = res.textString.replace(/^# .*\n\n?/, "")
                const author = item.querySelector(".AuthorInfo-name")?.textContent?.trim() || "匿名用户"
                const upvote = (item.querySelector('meta[itemprop="upvoteCount"]') as HTMLMetaElement | null)?.content
                const url = (item.querySelector('meta[itemprop="url"]') as HTMLMetaElement | null)?.content
                parts.push(
                    `## 回答 ${parts.length + 1}：${author}${upvote ? `（${upvote} 赞同）` : ""}\n\n` +
                    (url ? `> ${url}\n\n` : "") + body
                )
            } catch (e) {
                console.warn("复制第 " + (i + 1) + " 条回答失败", e)
            }
        }
    })
    const head = `# ${title}\n\n> 来源：${location.origin}${location.pathname}　共 ${parts.length} 条回答\n`
    return { text: [head].concat(parts).join("\n\n---\n\n"), count: parts.length }
}

async function run(btn: HTMLElement, copyText: (t: string) => Promise<void>) {
    if (btn.dataset.busy) return
    btn.dataset.busy = "1"
    const title = document.querySelector(".QuestionHeader-title")?.textContent?.trim() || document.title
    try {
        btn.textContent = "加载回答中…"
        await loadAllAnswers(n => { btn.textContent = `加载回答中… ${n}` })
        btn.textContent = "展开中…"
        await expandAll()
        const { text, count } = await collect(title, (d, t) => { btn.textContent = `整理中 ${d + 1}/${t}` })
        if (!count) throw new Error("没有可复制的回答")
        await copyText(text)
        btn.textContent = `已复制 ${count} 条回答 ✅`
        showToast(`✅ 已复制 ${count} 条回答（${text.length} 字）`)
    } catch (e) {
        console.log(e)
        btn.textContent = "发生错误❌ 请看控制台"
    } finally {
        setTimeout(() => { btn.textContent = LABEL; delete btn.dataset.busy }, 4000)
    }
}

// 在问题标题下方插入按钮；由 MutationObserver 反复调用，已存在则跳过
export function mountCopyAll(copyText: (t: string) => Promise<void>) {
    if (!isQuestionListPage()) return
    const titleEl = document.querySelector(".QuestionHeader-title")
    if (!titleEl || document.querySelector("." + BTN_CLASS)) return
    const btn = document.createElement("button")
    btn.className = `${BTN_CLASS} Button Button--blue`
    btn.style.cssText = "margin:8px 0;font-size:13px;"
    btn.textContent = LABEL
    btn.addEventListener("click", () => run(btn, copyText))
    titleEl.insertAdjacentElement("afterend", btn)
}
