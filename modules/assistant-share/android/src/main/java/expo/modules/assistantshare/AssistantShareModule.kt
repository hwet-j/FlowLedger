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
