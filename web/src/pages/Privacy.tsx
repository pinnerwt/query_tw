export function Privacy() {
  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6">
      <h1 className="text-2xl font-bold">隱私權政策</h1>
      <p className="text-xs text-slate-500">最後更新：2026-05-11</p>

      <section className="space-y-2">
        <h2 className="text-base font-semibold">我們收集什麼資料</h2>
        <p className="text-sm leading-6 text-slate-700 dark:text-slate-300">
          本網站（脆找工作）不要求註冊，也不會在伺服器端儲存任何可識別個人的資料。
          你建立的搜尋條件（profile）、收藏、已關閉公告與顯示偏好（深淺色主題等）
          全部以瀏覽器內的 <strong>localStorage / IndexedDB</strong> 儲存於你自己的裝置，
          不會傳送回我們的伺服器。
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold">職缺資料來源</h2>
        <p className="text-sm leading-6 text-slate-700 dark:text-slate-300">
          職缺內容來自 Threads 上的公開貼文，由我們抓取後以結構化方式呈現。
          我們不負責驗證徵才方的真實性，請務必自行查證；若懷疑詐騙，
          請參考站上公告或自行向 165 反詐騙專線通報。
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold">廣告與第三方 Cookie</h2>
        <p className="text-sm leading-6 text-slate-700 dark:text-slate-300">
          本網站使用 <strong>Google AdSense</strong> 顯示廣告。Google 及其合作夥伴
          會使用 cookie 根據你過去造訪本站與其他網站的紀錄投放廣告。
          你可以前往
          {' '}
          <a className="underline" href="https://adssettings.google.com" target="_blank" rel="noopener noreferrer">
            Google 廣告設定
          </a>
          {' '}
          停用個人化廣告，或前往
          {' '}
          <a className="underline" href="https://www.aboutads.info/choices/" target="_blank" rel="noopener noreferrer">
            aboutads.info
          </a>
          {' '}
          /
          {' '}
          <a className="underline" href="https://www.networkadvertising.org/choices/" target="_blank" rel="noopener noreferrer">
            networkadvertising.org
          </a>
          {' '}
          一次性停用多家廣告聯播網。
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold">伺服器存取紀錄</h2>
        <p className="text-sm leading-6 text-slate-700 dark:text-slate-300">
          反向代理（Cloudflare、nginx）可能會記錄 IP、User-Agent 等技術性資訊以維護服務穩定，
          這些紀錄僅用於除錯與防止濫用，不會與你的瀏覽器內資料連結。
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold">個資法（PDPA）</h2>
        <p className="text-sm leading-6 text-slate-700 dark:text-slate-300">
          本服務依中華民國《個人資料保護法》辦理。由於我們不主動向使用者收集姓名、電話、
          電子郵件等個人資料，使用者亦無需向本站行使個資法之查詢、更正或刪除權；
          若需移除瀏覽器內儲存的本地資料，請至「設定」頁面點選「清除全部本地資料」。
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold">政策變更</h2>
        <p className="text-sm leading-6 text-slate-700 dark:text-slate-300">
          我們可能會視需要更新本政策。修訂後的版本會以本頁面上方的「最後更新」日期標示。
        </p>
      </section>
    </div>
  );
}
