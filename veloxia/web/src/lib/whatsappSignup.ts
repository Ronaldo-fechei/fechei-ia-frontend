/**
 * Cadastro incorporado (Embedded Signup) do WhatsApp Business — fluxo oficial da Meta.
 * O cliente entra com a conta do Facebook numa janela da própria Meta, escolhe/cria a
 * conta do WhatsApp Business e o número. Recebemos apenas um código de uso único e os IDs;
 * o token é obtido e guardado pelo servidor (nunca aparece no navegador).
 */

interface FacebookSdk {
  init(opts: { appId: string; autoLogAppEvents?: boolean; xfbml?: boolean; version: string }): void;
  login(cb: (res: { authResponse?: { code?: string } | null; status?: string }) => void, opts: Record<string, unknown>): void;
}

declare global {
  interface Window {
    FB?: FacebookSdk;
    fbAsyncInit?: () => void;
  }
}

let sdkPromise: Promise<FacebookSdk> | null = null;

function loadSdk(appId: string, version: string): Promise<FacebookSdk> {
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise<FacebookSdk>((resolve, reject) => {
    window.fbAsyncInit = () => {
      window.FB!.init({ appId, autoLogAppEvents: true, xfbml: false, version });
      resolve(window.FB!);
    };
    const script = document.createElement("script");
    script.src = "https://connect.facebook.net/pt_BR/sdk.js";
    script.async = true;
    script.defer = true;
    script.crossOrigin = "anonymous";
    script.onerror = () => {
      sdkPromise = null;
      reject(new Error("Não foi possível carregar o login da Meta. Verifique se algum bloqueador de anúncios está impedindo o acesso a facebook.net."));
    };
    document.body.appendChild(script);
  });
  return sdkPromise;
}

export interface EmbeddedSignupResult {
  code: string;
  wabaId: string;
  phoneNumberId: string;
  businessId?: string;
  coexistence: boolean;
}

export class SignupCancelled extends Error {}

/**
 * Abre o cadastro incorporado. `coexistence` usa o fluxo de quem já usa o app WhatsApp Business
 * no celular e quer continuar usando o app junto com a API.
 */
export async function runEmbeddedSignup(opts: { appId: string; configId: string; version: string; coexistence: boolean }): Promise<EmbeddedSignupResult> {
  const FB = await loadSdk(opts.appId, opts.version);

  return new Promise<EmbeddedSignupResult>((resolve, reject) => {
    let session: { wabaId?: string; phoneNumberId?: string; businessId?: string } | null = null;
    let code: string | null = null;
    let finished = false;

    const done = (fn: () => void) => {
      if (finished) return;
      finished = true;
      window.removeEventListener("message", onMessage);
      fn();
    };
    const tryResolve = () => {
      if (code && session?.wabaId && session.phoneNumberId) {
        const result = { code, wabaId: session.wabaId, phoneNumberId: session.phoneNumberId, businessId: session.businessId, coexistence: opts.coexistence };
        done(() => resolve(result));
      }
    };

    function onMessage(event: MessageEvent) {
      let host = "";
      try {
        host = new URL(event.origin).hostname;
      } catch {
        return;
      }
      if (host !== "facebook.com" && !host.endsWith(".facebook.com")) return;
      let data: { type?: string; event?: string; data?: Record<string, string> };
      try {
        data = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
      } catch {
        return;
      }
      if (data?.type !== "WA_EMBEDDED_SIGNUP") return;
      if (data.event?.startsWith("FINISH")) {
        session = { wabaId: data.data?.waba_id, phoneNumberId: data.data?.phone_number_id, businessId: data.data?.business_id };
        tryResolve();
      } else if (data.event === "CANCEL") {
        done(() => reject(new SignupCancelled("Conexão cancelada antes de terminar.")));
      } else if (data.event === "ERROR") {
        const msg = data.data?.error_message;
        done(() => reject(new Error(msg ? `A Meta informou: ${msg}` : "A Meta informou um erro durante o cadastro.")));
      }
    }
    window.addEventListener("message", onMessage);

    FB.login(
      (res) => {
        code = res.authResponse?.code ?? null;
        if (!code) {
          done(() => reject(new SignupCancelled("Conexão cancelada.")));
          return;
        }
        tryResolve();
        // A mensagem com os IDs costuma chegar antes do retorno do login; se não chegar, avisa.
        setTimeout(() => {
          if (!finished) done(() => reject(new Error("A Meta não informou qual número foi escolhido. Tente novamente e conclua todas as etapas.")));
        }, 10_000);
      },
      {
        config_id: opts.configId,
        response_type: "code",
        override_default_response_type: true,
        extras: {
          setup: {},
          featureType: opts.coexistence ? "whatsapp_business_app_onboarding" : "",
          sessionInfoVersion: "3",
        },
      },
    );
  });
}
