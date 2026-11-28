package expo.modules.assistantshare

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * 이 모듈의 실체는 AssistantShareProvider(매니페스트의 ContentProvider)이다.
 * JS 쪽에서 부를 함수는 없다. DB 는 FlowDbModule(앱 JS)과 제공자가 SharedDb 의 같은 연결을 공유한다.
 */
class AssistantShareModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("AssistantShare")

    /**
     * 다른 내 앱의 읽기 전용 제공자 호출 (지금은 LeaseLog 의 스냅샷만). 허용 목록에 없는 authority 는 거부한다.
     * 반환: { json } 또는 { error }
     */
    /** 카드 알림 읽기(알림 접근) 허용 여부 */
    Function("notifyAccessEnabled") {
      val ctx = appContext.reactContext
      ctx != null && (android.provider.Settings.Secure.getString(ctx.contentResolver, "enabled_notification_listeners") ?: "")
        .split(":").any { android.content.ComponentName.unflattenFromString(it)?.packageName == ctx.packageName }
    }
    /** 시스템의 "알림 접근" 설정 화면을 연다 */
    Function("openNotifyAccessSettings") {
      val ctx = appContext.reactContext ?: return@Function false
      val i = android.content.Intent("android.settings.ACTION_NOTIFICATION_LISTENER_SETTINGS").addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
      try { ctx.startActivity(i); true } catch (e: Exception) { false }
    }
    /** 대기열(JSON 배열 문자열)을 지우지 않고 읽는다 / 비운다 */
    Function("peekNotifyQueue") { appContext.reactContext?.let { CardQueue.peek(it) } ?: "[]" }
    Function("clearNotifyQueue") { appContext.reactContext?.let { CardQueue.clear(it) }; null }

    AsyncFunction("callProvider") { authority: String, method: String ->
      if (authority !in ALLOWED_AUTHORITIES) return@AsyncFunction mapOf<String, Any?>("error" to "forbidden")
      val ctx = appContext.reactContext ?: return@AsyncFunction mapOf<String, Any?>("error" to "unavailable")
      try {
        val b = ctx.contentResolver.call(android.net.Uri.parse("content://$authority"), method, null, null)
        when {
          b == null -> mapOf<String, Any?>("error" to "unavailable")
          b.getString("error") != null -> mapOf<String, Any?>("error" to b.getString("error"))
          else -> mapOf<String, Any?>("json" to b.getString("json"))
        }
      } catch (e: Exception) {
        mapOf<String, Any?>("error" to "unavailable")
      }
    }
  }

  companion object {
    private val ALLOWED_AUTHORITIES = setOf("com.rentmanager.app.assistant")
  }
}
