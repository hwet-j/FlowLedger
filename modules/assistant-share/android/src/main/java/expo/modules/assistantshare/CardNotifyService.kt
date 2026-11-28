package expo.modules.assistantshare

import android.app.Notification
import android.content.Context
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import org.json.JSONArray
import org.json.JSONObject

/**
 * 카드 승인·입출금 알림을 읽어 대기열에 쌓는다 (사용자가 설정에서 "알림 접근"을 허용했을 때만 시스템이 연결해 준다).
 * 금액("N원")이 있고 결제·입출금 단어가 들어 있는 알림 글만 저장하고, 이 앱이 읽은 글은 기기 밖으로 나가지 않는다.
 * 대기열은 앱이 열릴 때 가져가 문자 가져오기 화면(검토 후 저장)으로 넘긴다. 자동으로 가계부에 넣지는 않는다.
 */
class CardNotifyService : NotificationListenerService() {
  override fun onNotificationPosted(sbn: StatusBarNotification?) {
    val n = sbn ?: return
    if (n.packageName == packageName) return
    val ex = n.notification?.extras ?: return
    if ((n.notification.flags and Notification.FLAG_GROUP_SUMMARY) != 0) return
    val title = ex.getCharSequence(Notification.EXTRA_TITLE)?.toString() ?: ""
    val body = (ex.getCharSequence(Notification.EXTRA_BIG_TEXT) ?: ex.getCharSequence(Notification.EXTRA_TEXT))?.toString() ?: ""
    val text = "$title $body".replace(Regex("\\s+"), " ").trim()
    if (!looksLikeTransaction(text)) return
    CardQueue.add(applicationContext, n.packageName, text.take(300), n.postTime)
  }

  companion object {
    private val AMOUNT = Regex("\\d[\\d,]*\\s*원")
    private val WORDS = Regex("승인|결제|출금|입금|사용|이체|체크카드|신용카드")
    fun looksLikeTransaction(text: String): Boolean = AMOUNT.containsMatchIn(text) && WORDS.containsMatchIn(text)
  }
}

/** SharedPreferences 에 JSON 배열로 보관하는 작은 대기열 (최대 100건) */
object CardQueue {
  private const val PREFS = "card_notify"
  private const val KEY = "queue"
  private const val MAX = 100

  @Synchronized
  fun add(ctx: Context, pkg: String, text: String, ts: Long) {
    val prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val arr = try { JSONArray(prefs.getString(KEY, "[]")) } catch (e: Exception) { JSONArray() }
    // 같은 알림이 갱신되어 다시 올 때(같은 앱·같은 글) 중복 저장하지 않는다
    for (i in 0 until arr.length()) {
      val o = arr.optJSONObject(i) ?: continue
      if (o.optString("x") == text && o.optString("p") == pkg) return
    }
    arr.put(JSONObject().put("t", ts).put("p", pkg).put("x", text))
    val out = JSONArray()
    val start = maxOf(0, arr.length() - MAX)
    for (i in start until arr.length()) out.put(arr.get(i))
    prefs.edit().putString(KEY, out.toString()).apply()
  }

  @Synchronized
  fun peek(ctx: Context): String = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, "[]") ?: "[]"

  @Synchronized
  fun clear(ctx: Context) { ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove(KEY).apply() }
}
