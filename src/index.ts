import { saveAs } from "file-saver"
import dealItem from "./dealItem"
import { mountCopyAll } from "./copyAll"
import * as JSZip from "jszip"
import { domToPng } from "modern-screenshot"
import { getCommentSwitch } from "./core/utils"
import { mountParseComments } from "./core/parseComments"
import { selectObsidianVault, saveFile } from "./core/obsidianSaver"
import { showToast } from "./core/toast"

/**
 * 适配复杂的想法：转发、带卡片链接、带@
 * 页：推送页，个人/机构主页，回答页，问题页，文章页，想法页，收藏夹页，搜索结果页，热榜，话题，圈子
 * 兼容知乎新版 T-Shape 左侧栏 UI 与经典 UI、暗黑模式、Chevron 触发与极简模式
 */

let registeredMenuIds: any[] = []

const getUIMode = (): "minimal" | "full" => {
    try {
        // @ts-ignore
        const val = GM_getValue("ui_mode")
        return val === "minimal" ? "minimal" : "full"
    } catch {
        return "full"
    }
}

const getSidebarTriggerMode = (): "hover_content" | "chevron" => {
    try {
        // @ts-ignore
        const val = GM_getValue("sidebar_trigger_mode")
        return val === "hover_content" ? "hover_content" : "chevron"
    } catch {
        return "chevron"
    }
}

function registerBtn() {
    try {
        const unregisterMenuCommand = (globalThis as any).GM_unregisterMenuCommand
        if (typeof unregisterMenuCommand === "function") {
            registeredMenuIds.forEach((id) => {
                if (id !== undefined && id !== null) unregisterMenuCommand(id)
            })
        }
        registeredMenuIds = []

        const uiMode = getUIMode()
        // @ts-ignore
        registeredMenuIds.push(GM_registerMenuCommand(
            `🎨 UI界面模式：${uiMode === "minimal" ? "【老版极简居中】（点击切换新版）" : "【新版增强侧边栏】（点击切换老版）"}`,
            function () {
                const nextMode = uiMode === "minimal" ? "full" : "minimal"
                // @ts-ignore
                GM_setValue("ui_mode", nextMode)
                location.reload()
            }
        ))

        const sidebarTriggerMode = getSidebarTriggerMode()
        // @ts-ignore
        registeredMenuIds.push(GM_registerMenuCommand(
            `🔘 侧边栏展开方式：${sidebarTriggerMode === "chevron" ? "【Chevron图标触发】（点击切换为【鼠标悬停正文】）" : "【鼠标悬停正文触发(原版)】（点击切换为【Chevron图标】）"}`,
            function () {
                const nextMode = sidebarTriggerMode === "chevron" ? "hover_content" : "chevron"
                // @ts-ignore
                GM_setValue("sidebar_trigger_mode", nextMode)
                location.reload()
            }
        ))

        // @ts-ignore
        registeredMenuIds.push(GM_registerMenuCommand(
            "（推荐）解析时跳过空白段落",
            function () {
                // @ts-ignore
                let ac = GM_getValue("skip_empty_p"), c
                !ac ? c = confirm("解析时跳过空白段落，避免产生大量多余的换行，你是否继续？") : alert("已取消跳过空白段落")
                // @ts-ignore
                GM_setValue("skip_empty_p", Boolean(c))
            }
        ))

        // @ts-ignore
        registeredMenuIds.push(GM_registerMenuCommand(
            "复制内容时添加fm元信息",
            function () {
                // @ts-ignore
                let ac = GM_getValue("copy_save_fm"), c
                !ac ? c = confirm("复制内容时，添加 frontmatter 信息，就像下载为纯文本的时候一样。你是否继续？") : alert("已取消复制添加fm")
                // @ts-ignore
                GM_setValue("copy_save_fm", Boolean(c))
            }
        ))

        // @ts-ignore
        registeredMenuIds.push(GM_registerMenuCommand(
            "复制内容时同时复制评论",
            function () {
                // @ts-ignore
                let ns = GM_getValue("copy_save_cm"), c
                !ns ? c = confirm("启用后，复制时也会复制评论，就像直接复制了下载的纯文本。你是否继续？") : alert("已取消复制评论")
                // @ts-ignore
                GM_setValue("copy_save_cm", Boolean(c))
            }
        ))

        // @ts-ignore
        registeredMenuIds.push(GM_registerMenuCommand(
            "下载zip时合并正文与评论",
            function () {
                // @ts-ignore
                let ns = GM_getValue("zip_merge_cm"), c
                !ns ? c = confirm("启用后，下载zip时会合并正文与评论到一个文件中。你是否继续？") : alert("已取消合并")
                // @ts-ignore
                GM_setValue("zip_merge_cm", Boolean(c))
            }
        ))

        // @ts-ignore
        registeredMenuIds.push(GM_registerMenuCommand(
            "复制与下载纯文本时不保存图片",
            function () {
                // @ts-ignore
                let ns = GM_getValue("no_save_img"), c
                !ns ? c = confirm("启用后，复制、存文本时将所有图片替换为“[图片]”，不影响存zip。你是否继续？") : alert("已取消不存图")
                // @ts-ignore
                GM_setValue("no_save_img", Boolean(c))
            }
        ))

        // @ts-ignore
        registeredMenuIds.push(GM_registerMenuCommand(
            "自定义保存后的文件名格式",
            function () {
                // @ts-ignore
                let efm = GM_getValue("edit_Filename")
                let fm = prompt(
                    `是否自定义保存后的文件名格式？留空或填错恢复默认\n默认为title + "_" + author.name + "_" + time.modified.slice(0, 10) + remark，你可以调整它的顺序，使用其他属性需要阅读源码\n(new Date).toLocaleDateString().replaceAll('/','-')添加保存日期`,
                    efm ? efm : 'title + "_" + author.name + "_" + time.modified.slice(0, 10) + remark'
                )
                // @ts-ignore
                GM_setValue("edit_Filename", fm)
            }
        ))
    } catch (e) {
        console.warn(e)
    }
}
registerBtn()

async function copyText(text: string): Promise<void> {
    try {
        // @ts-ignore
        if (typeof GM_setClipboard === "function") {
            // @ts-ignore
            GM_setClipboard(text, "text")
            return
        }
    } catch (e) {
        console.warn("GM_setClipboard 写入失败，尝试其他方案:", e)
    }

    if (navigator.clipboard?.writeText) {
        try {
            await navigator.clipboard.writeText(text)
            return
        } catch (error) {
            console.warn("浏览器剪贴板写入失败，尝试兼容方案:", error)
        }
    }

    const textarea = document.createElement("textarea")
    textarea.value = text
    textarea.style.position = "fixed"
    textarea.style.left = "-9999px"
    textarea.style.top = "-9999px"
    textarea.style.opacity = "0"
    document.body.appendChild(textarea)
    try {
        textarea.focus()
        textarea.select()
        textarea.setSelectionRange(0, text.length)
        if (!document.execCommand("copy")) throw new Error("浏览器拒绝了剪贴板操作")
    } finally {
        textarea.remove()
    }
}

const OBSIDIAN_ICON = `<svg style="width: 1.5em;height: 1.5em;opacity: 0.7;vertical-align: sub;" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path fill="currentColor" d="M19.355 18.538a68.967 68.959 0 0 0 1.858-2.954a.81.81 0 0 0-.062-.9c-.516-.685-1.504-2.075-2.042-3.362c-.553-1.321-.636-3.375-.64-4.377a1.7 1.7 0 0 0-.358-1.05l-3.198-4.064a4 4 0 0 1-.076.543c-.106.503-.307 1.004-.536 1.5c-.134.29-.29.6-.446.914l-.31.626c-.516 1.068-.997 2.227-1.132 3.59c-.124 1.26.046 2.73.815 4.481q.192.016.386.044a6.36 6.36 0 0 1 3.326 1.505c.916.79 1.744 1.922 2.415 3.5zM8.199 22.569q.11.019.22.02c.78.024 2.095.092 3.16.29c.87.16 2.593.64 4.01 1.055c1.083.316 2.198-.548 2.355-1.664c.114-.814.33-1.735.725-2.58l-.01.005c-.67-1.87-1.522-3.078-2.416-3.849a5.3 5.3 0 0 0-2.778-1.257c-1.54-.216-2.952.19-3.84.45c.532 2.218.368 4.829-1.425 7.531zM5.533 9.938q-.035.15-.098.29L2.82 16.059a1.6 1.6 0 0 0 .313 1.772l4.116 4.24c2.103-3.101 1.796-6.02.836-8.3c-.728-1.73-1.832-3.081-2.55-3.831zM9.32 14.01c.615-.183 1.606-.465 2.745-.534c-.683-1.725-.848-3.233-.716-4.577c.154-1.552.7-2.847 1.235-3.95q.17-.35.328-.664c.149-.297.288-.577.419-.86c.217-.47.379-.885.46-1.27c.08-.38.08-.72-.014-1.043c-.095-.325-.297-.675-.68-1.06a1.6 1.6 0 0 0-1.475.36l-4.95 4.452a1.6 1.6 0 0 0-.513.952l-.427 2.83c.672.59 2.328 2.316 3.335 4.711q.136.317.253.653"></path></svg>`

const SIDEBAR_BTNS_HTML = `<div class="zhihubackup-container">
    <button class="to-copy Button VoteButton">复制为Markdown</button>
    <button class="to-zip Button VoteButton">下载为 ZIP</button>
    <button class="to-text Button VoteButton">下载为纯文本</button>
    <button class="to-png Button VoteButton">剪藏为 PNG</button>
    <button class="to-obsidian Button VoteButton">${OBSIDIAN_ICON} 保存到<br>指定文件夹</button>
    <div class="Button VoteButton" style="display: inline-block;box-sizing: border-box;overflow: hidden;">
        <textarea class="to-remark" placeholder="添加备注" style="width: 100%;" maxlength="60"></textarea>
    </div>
    <div class="Button VoteButton" style="display: inline-block;box-sizing: border-box;">
        <label><input type="checkbox" checked class="to-cm"> 保存评论</label>
    </div>
</div>`

const renderContainerHTML = (): string => {
    if (getUIMode() === "minimal") {
        return `<div class="zhcollect-minimal-btns">
    <button class="to-copy-context zhcollect-btn" style="border-radius:1em 0 0 1em;padding-left:.5em;">复制标题+正文</button>
    <button class="to-copy-content zhcollect-btn" style="border-radius:0 1em 1em 0;padding-right:.5em;">复制正文</button>
</div>`
    }
    if (getSidebarTriggerMode() === "chevron") {
        return `<div class="zhihubackup-sticky-box">
    ${SIDEBAR_BTNS_HTML}
    <div class="zhihubackup-trigger" title="展开剪藏工具栏"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg></div>
</div>`
    }
    return SIDEBAR_BTNS_HTML
}

const ButtonContainer = document.createElement("div")
if (getUIMode() === "full") {
    ButtonContainer.classList.add("zhihubackup-wrap")
    if (getSidebarTriggerMode() === "chevron") {
        ButtonContainer.classList.add("zhihubackup-chevron-mode")
    }
}
ButtonContainer.innerHTML = renderContainerHTML()

const getScreenshotBg = (): string =>
    document.documentElement.getAttribute("data-theme") === "dark" ? "#22272E" : "#ffffff"

const main = async () => {
    const uiMode = getUIMode()
    const RichTexts = Array.from(document.querySelectorAll(".RichText")) as HTMLElement[]
    for (let RichText of RichTexts) {
        try {
            let result: {
                zip?: JSZip,
                textString?: string,
                title: string,
            }
            if (!RichText.parentElement || RichText.parentElement.classList.contains("Editable")) continue
            if (RichText.closest(".QuestionRichText")) continue // 排除问题描述区的 RichText，仅挂载回答/文章/想法
            if (window.location.hostname.includes("zhuanlan")) {
                const postMain = RichText.closest(".Post-Main")
                if (!postMain || postMain.querySelector(".zhcollect-minimal-btns, .zhihubackup-container")) continue
            } else {
                if (RichText.closest(".PinItem")) {
                    if (!RichText.closest(".RichContent-inner")) continue
                    if (RichText.closest(".PinItem-content-originpin")) continue
                }
                const richContent = RichText.closest(".RichContent")
                if (!richContent || richContent.querySelector(".zhcollect-minimal-btns, .zhihubackup-container")) continue
                const richInner = RichText.closest(".RichContent-inner")
                if (richInner && richInner.querySelector(".ContentItem-more")) continue
                if (richContent.querySelector(".ContentItem-expandButton")) continue
            }

            const aButtonContainer = ButtonContainer.cloneNode(true) as HTMLDivElement
            const parent_dom = (RichText.closest(".List-item") ||
                RichText.closest(".Post-content") ||
                RichText.closest(".PinItem") ||
                RichText.closest(".CollectionDetailPageItem") ||
                RichText.closest(".Card")) as HTMLElement | null
            if (!parent_dom) continue

            if (uiMode === "full") {
                if (parent_dom.querySelector(".Catalog") || (window.location.hostname.includes("zhuanlan") && document.querySelector(".Catalog"))) {
                    aButtonContainer.classList.add("has-catalog-right")
                }
                const p = (RichText.closest(".RichContent") || RichText.closest(".Post-RichTextContainer")) as HTMLElement | null
                if (!p) continue
                p.prepend(aButtonContainer)

                const closeAllSidebars = (except?: HTMLElement) => {
                    document.querySelectorAll(".zhihubackup-wrap.is-open").forEach((el) => {
                        if (el !== except) el.classList.remove("is-open")
                    })
                }
                const trigger = aButtonContainer.querySelector(".zhihubackup-trigger") as HTMLElement | null
                if (trigger) {
                    trigger.addEventListener("mouseenter", () => {
                        closeAllSidebars(aButtonContainer)
                        aButtonContainer.classList.add("is-open")
                    })
                    trigger.addEventListener("click", (e) => {
                        e.stopPropagation()
                        const wasOpen = aButtonContainer.classList.contains("is-open")
                        closeAllSidebars()
                        if (!wasOpen) aButtonContainer.classList.add("is-open")
                    })
                    aButtonContainer.addEventListener("mouseleave", () => {
                        aButtonContainer.classList.remove("is-open")
                    })
                }
            } else {
                RichText.prepend(aButtonContainer)
            }

            const textareaRemark = aButtonContainer.querySelector(".to-remark") as HTMLTextAreaElement | null
            textareaRemark?.addEventListener("click", (e) => {
                e.stopPropagation()
                e.preventDefault()
                textareaRemark.focus()
            }, true)

            const bindCopyAction = (selector: string, mode: string, defaultLabel: string) => {
                const btn = aButtonContainer.querySelector(selector) as HTMLElement | null
                if (!btn) return
                btn.addEventListener("click", throttle(async (event: Event) => {
                    try {
                        const res = await dealItem(RichText, mode, event)
                        if (!res) return
                        await copyText(res.textString || "")
                        btn.innerHTML = "复制成功✅"
                        setTimeout(() => { btn.innerHTML = defaultLabel }, 2500)
                    } catch (e) {
                        console.log(e)
                        btn.innerHTML = "发生错误❌"
                        setTimeout(() => { btn.innerHTML = defaultLabel }, 3000)
                    }
                }))
            }

            bindCopyAction(".to-copy", "copy", "复制为Markdown")
            bindCopyAction(".to-copy-context", "copy_context", "复制标题+正文")
            bindCopyAction(".to-copy-content", "copy_content", "复制正文")

            const ButtonZip = aButtonContainer.querySelector(".to-zip") as HTMLElement | null
            ButtonZip?.addEventListener("click", throttle(async (event: Event) => {
                try {
                    ButtonZip.innerHTML = "下载中……"
                    const res = await dealItem(RichText, "zip", event)
                    if (!res || !res.zip) {
                        ButtonZip.innerHTML = "下载为 ZIP"
                        return
                    }
                    result = { zip: res.zip, title: res.title || "untitled" }
                    const blob = await result.zip!.generateAsync({ type: "blob" })
                    saveAs(blob, result.title + ".zip")
                    ButtonZip.innerHTML = "下载成功✅<br>请看下载记录"
                    setTimeout(() => { ButtonZip.innerHTML = "下载为 ZIP" }, 5000)
                } catch (e) {
                    console.log(e)
                    ButtonZip.innerHTML = "发生错误❌<br>请打开控制台查看"
                    setTimeout(() => { ButtonZip.innerHTML = "下载为 ZIP" }, 5000)
                }
            }))

            const ButtonPNG = aButtonContainer.querySelector(".to-png") as HTMLElement | null
            ButtonPNG?.addEventListener("click", throttle(async (event: Event) => {
                try {
                    const res = await dealItem(RichText, "png", event)
                    if (!res) return
                    result = { title: res.title || "untitled" }

                    const clip = parent_dom
                    clip.classList.add("to-screenshot")
                    const saveCM = getCommentSwitch(RichText)
                    if (!saveCM) clip.classList.add("no-cm")
                    const svgDefs = document.querySelector("#MathJax_SVG_glyphs") as HTMLElement | null
                    const svgVisibility = svgDefs?.style.visibility || ""
                    if (svgDefs) svgDefs.style.visibility = "visible"

                    try {
                        const dataUrl = await domToPng(clip, {
                            backgroundColor: getScreenshotBg(),
                            filter(el) {
                                if ((el as HTMLElement).tagName === "DIV" && (
                                    (el as HTMLElement).classList.contains("zhihubackup-wrap") ||
                                    (el as HTMLElement).classList.contains("zhcollect-minimal-btns")
                                )) return false
                                return true
                            },
                        })
                        const link = document.createElement("a")
                        link.download = result.title + ".png"
                        link.href = dataUrl
                        link.click()
                        ButtonPNG.innerHTML = "请稍待片刻✅<br>查看下载记录"
                        setTimeout(() => { ButtonPNG.innerHTML = "剪藏为 PNG" }, 5000)
                    } finally {
                        clip.classList.remove("to-screenshot")
                        if (!saveCM) clip.classList.remove("no-cm")
                        if (svgDefs) svgDefs.style.visibility = svgVisibility
                    }
                } catch (e) {
                    console.log(e)
                    ButtonPNG.innerHTML = "发生错误❌<br>请打开控制台查看"
                    setTimeout(() => { ButtonPNG.innerHTML = "剪藏为 PNG" }, 5000)
                }
            }))

            const ButtonText = aButtonContainer.querySelector(".to-text") as HTMLElement | null
            ButtonText?.addEventListener("click", throttle(async (event: Event) => {
                try {
                    const res = await dealItem(RichText, "text", event)
                    if (!res) return
                    result = { textString: res.textString, title: res.title || "untitled" }
                    const blob = new Blob([result.textString || ""], { type: "text/plain" })
                    saveAs(blob, result.title + ".md")
                    ButtonText.innerHTML = "下载成功✅<br>请看下载记录，以文本方式打开"
                    setTimeout(() => { ButtonText.innerHTML = "下载为纯文本" }, 5000)
                } catch (e) {
                    console.log(e)
                    ButtonText.innerHTML = "发生错误❌<br>请打开控制台查看"
                    setTimeout(() => { ButtonText.innerHTML = "下载为纯文本" }, 5000)
                }
            }))

            const ButtonObsidian = aButtonContainer.querySelector(".to-obsidian") as HTMLElement | null
            ButtonObsidian?.addEventListener("click", throttle(async () => {
                try {
                    const saveType = await selectObsidianVault()
                    if (!saveType) return

                    if (saveType == "text") {
                        const res = await dealItem(RichText, "text")
                        if (!res) return
                        result = { textString: res.textString, title: res.title || "untitled" }
                        await saveFile(result, saveType as any)
                    } else if (saveType.slice(0, 3) == "zip") {
                        const res = await dealItem(RichText, "zip")
                        if (!res) return
                        result = { zip: res.zip, title: res.title || "untitled" }
                        await saveFile(result, saveType as any)
                    } else if (saveType == "png") {
                        const res = await dealItem(RichText, "png")
                        if (!res) return

                        const clip = parent_dom
                        clip.classList.add("to-screenshot")
                        const saveCM = getCommentSwitch(RichText)
                        if (!saveCM) clip.classList.add("no-cm")
                        const svgDefs = document.querySelector("#MathJax_SVG_glyphs") as HTMLElement | null
                        const svgVisibility = svgDefs?.style.visibility || ""
                        if (svgDefs) svgDefs.style.visibility = "visible"

                        try {
                            const dataUrl = await domToPng(clip, {
                                backgroundColor: getScreenshotBg(),
                                filter(el) {
                                    if ((el as HTMLElement).tagName === "DIV" && (
                                        (el as HTMLElement).classList.contains("zhihubackup-wrap") ||
                                        (el as HTMLElement).classList.contains("zhcollect-minimal-btns")
                                    )) return false
                                    return true
                                },
                            })
                            result = { textString: dataUrl, title: res.title || "untitled" }
                            await saveFile(result, saveType as any)
                        } finally {
                            clip.classList.remove("to-screenshot")
                            if (!saveCM) clip.classList.remove("no-cm")
                            if (svgDefs) svgDefs.style.visibility = svgVisibility
                        }
                    }
                } catch (e) {
                    console.log(e)
                    alert("发生错误❌请打开控制台查看\n你可以关闭窗口后再试一次！")
                }
            }))
        } catch (e) {
            console.log(e)
        }
    }
}

function throttle(fn: Function, delay: number = 2000) {
    let flag = true
    return function (this: any, ...args: any[]) {
        if (flag) {
            flag = false
            setTimeout(() => {
                flag = true
            }, delay)
            return fn.apply(this, args)
        }
    }
}

setTimeout(() => {
    const node = document.createElement("style")
    node.appendChild(document.createTextNode(`
    /* ========== Minimal Mode ========== */
    .zhcollect-minimal-btns {
        user-select: none;
        margin-bottom: 8px;
    }
    .zhcollect-btn {
        width: 120px;
        height: 2.1em;
        background-color: rgba(85, 85, 85, 0.9);
        color: #fff;
        outline: none;
        cursor: pointer;
        border: none;
        border-radius: 1em;
        margin: 0 .15em .6em .15em;
        font-size: .82em;
        z-index: 20;
    }
    .zhcollect-btn:hover {
        background-color: rgba(23, 114, 246, 0.95);
    }

    /* ========== Full Sidebar Mode ========== */
    .RichContent,
    .Post-RichTextContainer {
        position: relative;
    }
    .Card:has(.zhihubackup-wrap),
    .List-item:has(.zhihubackup-wrap),
    .Question-mainColumn:has(.zhihubackup-wrap),
    .Topstory-mainColumn:has(.zhihubackup-wrap) {
        overflow: visible !important;
    }
    .zhihubackup-wrap {
        position: absolute;
        left: -9.8em;
        top: -80px;
        height: calc(100% + 80px);
        min-height: 200px;
        user-select: none;
        width: 9.8em;
        z-index: 20;
        pointer-events: none;
    }
    .Post-content:has(.Catalog) .zhihubackup-wrap,
    .Post-Main:has(.Catalog) .zhihubackup-wrap,
    .zhihubackup-wrap.has-catalog-right {
        left: calc(100% + 16px) !important;
        right: unset !important;
    }

    /* Hover Mode */
    .zhihubackup-wrap:not(.zhihubackup-chevron-mode) {
        opacity: 0;
        transition: opacity 0.25s ease;
    }
    .RichContent:hover .zhihubackup-wrap:not(.zhihubackup-chevron-mode),
    .ContentItem:hover .zhihubackup-wrap:not(.zhihubackup-chevron-mode),
    .Post-content:hover .zhihubackup-wrap:not(.zhihubackup-chevron-mode),
    .Post-RichTextContainer:hover .zhihubackup-wrap:not(.zhihubackup-chevron-mode),
    .zhihubackup-wrap:not(.zhihubackup-chevron-mode):hover {
        opacity: 1;
        pointer-events: auto;
    }
    .zhihubackup-wrap:not(.zhihubackup-chevron-mode) .zhihubackup-container {
        position: sticky;
        top: 110px;
        display: flex;
        flex-direction: column;
        width: min-content;
        max-width: 8.2em;
        z-index: 20;
        pointer-events: auto;
    }

    /* Chevron Mode */
    .zhihubackup-chevron-mode .zhihubackup-sticky-box {
        position: sticky;
        top: 170px;
        display: flex;
        flex-direction: row;
        align-items: flex-start;
        justify-content: flex-end;
        gap: 8px;
        width: 100%;
        pointer-events: none;
    }
    .Post-content:has(.Catalog) .zhihubackup-chevron-mode .zhihubackup-sticky-box,
    .Post-Main:has(.Catalog) .zhihubackup-chevron-mode .zhihubackup-sticky-box,
    .zhihubackup-wrap.has-catalog-right.zhihubackup-chevron-mode .zhihubackup-sticky-box {
        flex-direction: row-reverse;
    }
    .zhihubackup-chevron-mode .zhihubackup-trigger {
        position: relative;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        color: rgba(60, 60, 60, 0.75);
        background: rgba(255, 255, 255, 0.88);
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
        border: 1px solid rgba(0, 0, 0, 0.08);
        box-shadow: 0 3px 10px rgba(0, 0, 0, 0.08);
        transition: opacity 0.22s ease, background 0.22s ease, transform 0.22s ease, color 0.22s ease, border-color 0.22s ease;
        opacity: 0.42;
        z-index: 21;
        pointer-events: auto;
        box-sizing: border-box;
        width: 24px;
        height: 38px;
        border-radius: 12px;
        flex-shrink: 0;
        margin-right: 10px;
    }
    html[data-theme="dark"] .zhihubackup-chevron-mode .zhihubackup-trigger {
        color: #adbac7;
        background: rgba(45, 51, 59, 0.9);
        border-color: rgba(255, 255, 255, 0.14);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.32);
    }
    .zhihubackup-chevron-mode .zhihubackup-trigger::before {
        content: '';
        position: absolute;
        inset: -12px;
        border-radius: inherit;
    }
    .zhihubackup-chevron-mode .zhihubackup-trigger svg {
        transition: transform 0.25s ease;
    }
    .zhihubackup-wrap.is-open .zhihubackup-trigger,
    .zhihubackup-chevron-mode .zhihubackup-trigger:hover {
        opacity: 1 !important;
        background: rgba(255, 255, 255, 0.98);
        border-color: rgba(23, 114, 246, 0.35);
        transform: scale(1.12);
        color: #1772f6;
    }
    html[data-theme="dark"] .zhihubackup-wrap.is-open .zhihubackup-trigger,
    html[data-theme="dark"] .zhihubackup-chevron-mode .zhihubackup-trigger:hover {
        background: #373E47;
        border-color: rgba(88, 166, 255, 0.5);
        color: #58a6ff;
    }
    .zhihubackup-chevron-mode .zhihubackup-container {
        display: flex;
        flex-direction: column;
        width: min-content;
        max-width: 8.2em;
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.22s ease;
        padding: 6px;
        border-radius: 10px;
        background: rgba(255, 255, 255, 0.96);
        box-shadow: 0 6px 20px rgba(0, 0, 0, 0.12);
    }
    html[data-theme="dark"] .zhihubackup-chevron-mode .zhihubackup-container,
    html[data-theme="dark"] .zhihubackup-wrap:not(.zhihubackup-chevron-mode) .zhihubackup-container {
        background: rgba(34, 39, 46, 0.96);
        box-shadow: 0 6px 20px rgba(0, 0, 0, 0.45);
        padding: 6px;
        border-radius: 10px;
        border: 1px solid #373E47;
    }
    .zhihubackup-wrap.is-open {
        pointer-events: auto;
    }
    .zhihubackup-wrap.is-open .zhihubackup-container {
        opacity: 1;
        pointer-events: auto;
    }
    .zhihubackup-wrap.is-open .zhihubackup-trigger svg {
        transform: rotate(180deg);
    }

    .zhihubackup-container .Button {
        width: 8em;
        margin-bottom: 6px;
        line-height: 22px !important;
        padding: 4px 8px !important;
    }
    .zhihubackup-container .Button:last-child {
        margin-bottom: 0;
    }
    html[data-theme="dark"] .zhihubackup-container .Button.VoteButton {
        background-color: #2D333B !important;
        color: #58a6ff !important;
        border: 1px solid #444c56 !important;
    }
    html[data-theme="dark"] .zhihubackup-container .Button.VoteButton:hover {
        background-color: #373E47 !important;
    }
    .zhihubackup-container input,
    .zhihubackup-container textarea {
        background-color: transparent;
        font-size: 13px;
        color: inherit;
        border: unset;
        text-align: center;
        outline: unset;
        height: 100%;
        resize: none;
        overflow: hidden;
        line-height: 1.5em;
        vertical-align: middle;
    }
    div.Button.VoteButton:has(input:focus),
    div.Button.VoteButton:has(textarea:focus),
    div.Button.VoteButton:has(textarea:hover) {
        resize: both;
        overflow: hidden;
    }

    /* 窄屏自适应：收进卡片右上角内侧避免被左边界裁切 */
    @media (max-width: 1180px) {
        .zhihubackup-wrap {
            left: unset !important;
            right: 0 !important;
        }
        .zhihubackup-chevron-mode .zhihubackup-sticky-box {
            flex-direction: row-reverse;
        }
        .zhihubackup-chevron-mode .zhihubackup-trigger {
            margin-right: 0;
            margin-left: 6px;
        }
    }

    /* 截图净化 */
    .to-screenshot .ContentItem-actions {
        position: initial!important;
        box-shadow: unset!important;
        margin: 0 -20px -10px!important;
    }
    .to-screenshot.Post-content .RichContent-actions {
        position: initial!important;
        box-shadow: unset!important;
    }
    .to-screenshot.Post-content {
        width: 780px;
        margin: 0 auto;
        min-width: unset!important;
    }
    .to-screenshot .Post-Main {
        display: flex;
        flex-direction: column;
        align-items: center;
    }
    .to-screenshot.PinItem .RichText>.RichText:has(a[data-first-child]) {
        display: flex;
        flex-direction: column;
        align-items: center;
    }
    .to-screenshot .ContentItem-actions>.ContentItem-actions {
        margin-top: -10px!important;
    }
    .to-screenshot .css-m4psdq,
    .to-screenshot .AppHeader-profileAvatar {
        opacity: 0;
    }
    .to-screenshot.no-cm .Comments-container,
    .to-screenshot noscript,
    .to-screenshot .Recommendations-Main,
    .to-screenshot .css-kt4t4n {
        display: none;
    }
    .to-screenshot .RichText-LinkCardContainer {
        display: flex;
        justify-content: center;
    }
    .to-screenshot .LinkCard.new,
    .to-screenshot .Comments-container {
        margin: 0 !important;
    }
    .to-screenshot .FeedSource {
        margin-bottom: 14px !important;
    }
    .to-screenshot .Comments-container>div>div {
        margin-bottom: 10px !important;
    }
    .to-screenshot.PinItem {
        margin: 16px 0;
        padding: 0 16px;
        width: 690px;
    }
    .PinDetail:has(.to-screenshot) {
        max-width: 706px!important;
    }
    .RichContent:has(.ContentItem-more) .zhihubackup-wrap,
    .Post-RichTextContainer:has(.ContentItem-more) .zhihubackup-wrap,
    .RichContent:has(.ContentItem-more) .zhcollect-minimal-btns,
    .Post-RichTextContainer:has(.ContentItem-more) .zhcollect-minimal-btns {
        display: none;
    }
    .comment-parser-container {
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.3s;
    }
    .Comments-container:hover .comment-parser-container,
    .Modal-content:hover .comment-parser-container {
        opacity: 1;
        pointer-events: initial;
    }
    `))
    document.querySelector("head")?.appendChild(node)
}, 30)

setTimeout(() => {
    main()
    mountCopyAll(copyText)
    mountParseComments()
    // @ts-ignore
    window.zhbf = main
    // @ts-ignore
    window.ArticleComments = window.ArticleComments || {}
    document.querySelector(".Topstory-tabs")?.addEventListener("click", () => {
        setTimeout(registerBtn, 100)
    })
}, 300)

let timer: any = null
window.addEventListener("scroll", () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(main, 1000)
}, { passive: true })

let domTimer: any = null
new MutationObserver(() => {
    if (domTimer) return
    domTimer = setTimeout(() => {
        domTimer = null
        main()
        mountCopyAll(copyText)
    }, 120)
}).observe(document, { childList: true, subtree: true })
main()
