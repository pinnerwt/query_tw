import { Link } from 'react-router-dom';

export function Faq() {
  return (
    <div className="mx-auto max-w-3xl space-y-8 p-4 sm:p-6">
      <h1 className="text-2xl font-bold">問與答</h1>

      <section className="space-y-2">
        <h2 className="text-base font-semibold">什麼是「個人檔案 (Profile)」？</h2>
        <p className="text-sm leading-6 text-slate-700 dark:text-slate-300">
          個人檔案是一組你關心的搜尋條件。你可以建立多個（例如「前端工程師 · 台北」、「PM · 遠端」），
          每個 profile 都帶有自己的<strong>側邊篩選</strong>：城市、薪資、工作型態、技能、經歷、語言、關鍵字等。
          切換 profile 時，主畫面會立刻套用該 profile 儲存的所有篩選；你不需要每次都重新調整。
        </p>
        <p className="text-sm leading-6 text-slate-700 dark:text-slate-300">
          你可以在主畫面左上的下拉選單切換或新增 profile。
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold">收藏 (Favorites) 怎麼運作？</h2>
        <p className="text-sm leading-6 text-slate-700 dark:text-slate-300">
          每張職缺卡片右上角的 ☆ 點下去就變成 ★，加入收藏；再次點擊則取消。
          所有收藏都集中在<Link to="/favorites" className="mx-1 underline">收藏</Link>頁面，與目前的篩選和 profile 無關，
          方便你日後追蹤想要應徵的職缺。
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold">資料存在哪裡？</h2>
        <p className="text-sm leading-6 text-slate-700 dark:text-slate-300">
          所有 profile、篩選、收藏、已看過的紀錄都<strong>存在你這台裝置的瀏覽器本機</strong>，
          不會上傳到伺服器，也沒有帳號系統。
          這代表：
        </p>
        <ul className="ml-5 list-disc space-y-1 text-sm leading-6 text-slate-700 dark:text-slate-300">
          <li>清除瀏覽器資料 / 換瀏覽器 / 換裝置，紀錄會跟著消失。</li>
          <li>同一台裝置不同瀏覽器之間也不會共用。</li>
          <li>沒有人看得到你關心什麼條件、收藏了哪些工作。</li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold">怎麼把資料帶到另一台裝置？</h2>
        <p className="text-sm leading-6 text-slate-700 dark:text-slate-300">
          打開<Link to="/settings" className="mx-1 underline">設定</Link>頁面，
          在「匯出 Profiles (QR)」區塊產生一張 QR Code，
          然後在另一台裝置打開設定頁面的「掃描匯入」並對著 QR Code 掃描，所有 profile 與收藏就會同步過去。
        </p>
        <p className="text-sm leading-6 text-slate-500">
          QR Code 內含的是壓縮過的 JSON，不會經過任何伺服器中轉。
        </p>
      </section>
    </div>
  );
}
