/*
  ARQUIVO: GateOS_Sinric_Independente.ino
  DESCRIÇÃO: Firmware GateOS Pro para ESP-01S 
  MODELO DE NEGÓCIOS: O cliente insere as credenciais do Sinric Pro e o E-mail. A placa se auto-registra no backend.
  HARDWARE: ESP-01S + Módulo Relé
*/

#include <ESP8266WiFi.h>
#include <ESP8266WebServer.h>
#include <DNSServer.h>
#include <LittleFS.h>
#include <SinricPro.h>
#include <SinricProSwitch.h>
#include <ESP8266HTTPClient.h> // Biblioteca para enviar o POST ao seu servidor
#include <WiFiClient.h>

// --- HARDWARE ---
#define PINO_RELE 0        // O ESP-01S no módulo relé usa o GPIO 0
#define PINO_RESET_WIFI 2  // Usamos o GPIO 2 para reset físico (se necessário)

// --- OBJETOS DE REDE E SERVIDOR ---
ESP8266WebServer server(80);
DNSServer dnsServer;
const byte DNS_PORT = 53;

// --- VARIÁVEIS DE CONFIGURAÇÃO ---
String ssid_str = "";
String pass_str = "";
String app_key_str = "";
String app_secret_str = "";
String sinric_id_str = "";
String email_str = "";     // NOVO: Armazena o e-mail do cliente
bool emModoConfig = false;

// Função chamada pelo Google Home / Alexa / Sinric Pro
bool onPowerState(const String &deviceId, bool &state) {
  if (state) {
    Serial.println("Comando de Voz Recebido: ABRINDO O PORTÃO!");
    // O módulo relé ESP-01S atrai em LOW
    digitalWrite(PINO_RELE, LOW);
    delay(500); // Pulso de meio segundo
    digitalWrite(PINO_RELE, HIGH);
    
    // Força o botão no app a voltar a "Desligado" após o pulso
    SinricProSwitch& mySwitch = SinricPro[sinric_id_str];
    mySwitch.sendPowerStateEvent(false);
  }
  return true;
}

void carregarConfiguracoes() {
  if (LittleFS.begin()) {
    if (LittleFS.exists("/config.txt")) {
      File f = LittleFS.open("/config.txt", "r");
      if (f) {
        ssid_str = f.readStringUntil('\n'); ssid_str.trim();
        pass_str = f.readStringUntil('\n'); pass_str.trim();
        app_key_str = f.readStringUntil('\n'); app_key_str.trim();
        app_secret_str = f.readStringUntil('\n'); app_secret_str.trim();
        sinric_id_str = f.readStringUntil('\n'); sinric_id_str.trim();
        email_str = f.readStringUntil('\n'); email_str.trim(); // Lê o e-mail salvo
        f.close();
      }
    }
  }
}

void guardarConfiguracoes(String q_ssid, String q_pass, String q_app_key, String q_app_secret, String q_id, String q_email) {
  File f = LittleFS.open("/config.txt", "w");
  if (f) {
    f.println(q_ssid);
    f.println(q_pass);
    f.println(q_app_key);
    f.println(q_app_secret);
    f.println(q_id);
    f.println(q_email); // Salva o e-mail na memória flash
    f.close();
  }
}

void apagarConfiguracoes() {
  LittleFS.format();
  ESP.restart();
}

void setup() {
  Serial.begin(115200);
  delay(500);

  // Configura o Relé
  pinMode(PINO_RELE, OUTPUT);
  digitalWrite(PINO_RELE, HIGH); // Inicia com o relé desligado
  pinMode(PINO_RESET_WIFI, INPUT_PULLUP);

  carregarConfiguracoes();
  
  // Verifica se faltam dados essenciais (incluindo o e-mail)
  if (ssid_str == "" || app_key_str == "" || app_secret_str == "" || sinric_id_str == "" || email_str == "") {
    setupModoConfiguracao();
  } else {
    setupModoOperacao();
  }
}

void loop() {
  // Reset de fábrica: Jumper do pino 2 ao GND por 5 segundos
  if (digitalRead(PINO_RESET_WIFI) == LOW) {
    delay(5000);
    if (digitalRead(PINO_RESET_WIFI) == LOW) {
      Serial.println("Apagando configurações...");
      apagarConfiguracoes();
    }
  }

  if (emModoConfig) {
    dnsServer.processNextRequest();
    server.handleClient();
  } else {
    SinricPro.handle();
  }
}

void setupModoOperacao() {
  emModoConfig = false;
  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid_str.c_str(), pass_str.c_str());

  Serial.print("Conectando ao Wi-Fi");
  int tentativas = 0;
  while (WiFi.status() != WL_CONNECTED && tentativas < 30) {
    delay(500);
    Serial.print(".");
    tentativas++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\nWi-Fi Conectado!");

    // =======================================================
    // TELEMETRIA INVISÍVEL (Zero-Touch Provisioning)
    // =======================================================
    WiFiClient client;
    HTTPClient http;
    
    // ATENÇÃO: Troque pelo IP/Domínio do seu servidor Node.js
    http.begin(client, "http://SEU_IP_OU_DOMINIO:3000/devices/home/ativar"); 
    http.addHeader("Content-Type", "application/json");

    String mac = WiFi.macAddress();
    String payload = "{\"email\":\"" + email_str + "\", \"mac\":\"" + mac + "\", \"sinricId\":\"" + sinric_id_str + "\"}";
    
    Serial.println("Avisando servidor Cortex sobre a ativação...");
    int httpResponseCode = http.POST(payload);
    
    if (httpResponseCode > 0) {
      Serial.println("GateOS Home registrado no servidor Cortex com sucesso!");
    } else {
      Serial.print("Erro de comunicação com o servidor Cortex. Código: ");
      Serial.println(httpResponseCode);
    }
    http.end();
    // =======================================================

    // Inicia a comunicação com a Alexa/Google Home via Sinric Pro
    SinricProSwitch& mySwitch = SinricPro[sinric_id_str];
    mySwitch.onPowerState(onPowerState);
    SinricPro.begin(app_key_str.c_str(), app_secret_str.c_str());
    SinricPro.restoreDeviceStates(true);
    
  } else {
    Serial.println("\nFalha no Wi-Fi. Voltando ao Modo de Configuração.");
    setupModoConfiguracao();
  }
}

// --- PORTAL DE CONFIGURAÇÃO (HTML) ---
void setupModoConfiguracao() {
  emModoConfig = true;
  WiFi.disconnect(true); delay(100);
  WiFi.mode(WIFI_AP);
  IPAddress apIP(192, 168, 4, 1);
  WiFi.softAPConfig(apIP, apIP, IPAddress(255, 255, 255, 0));
  WiFi.softAP("GateOS", "12345678");

  dnsServer.setErrorReplyCode(DNSReplyCode::NoError);
  dnsServer.start(DNS_PORT, "*", WiFi.softAPIP());

  auto pageHandler = []() {
    int n = WiFi.scanNetworks();
    String opcoesWifi = (n == 0) ? "<option value=''>Nenhuma rede encontrada</option>" : "";
    for (int i = 0; i < n; ++i) {
      String ssid = WiFi.SSID(i);
      String rssi = String(WiFi.RSSI(i));
      opcoesWifi += "<option value='" + ssid + "'>" + ssid + " (" + rssi + "dBm)</option>";
    }

    String html = R"rawliteral(
<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.8/dist/css/bootstrap.min.css" rel="stylesheet">
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.13.1/font/bootstrap-icons.min.css">
    <title>Instalação GateOS</title>
    <style>
        :root { --bg: #0f172a; --card: #1e293b; --primary: #3b82f6; --text: #f1f5f9; --input-bg: #334155; }
        * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; margin: 0; padding: 0; }
        body { background-color: var(--bg); color: var(--text); display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 20px; }
        .container { background-color: var(--card); border-radius: 16px; padding: 30px; width: 100%; max-width: 400px; box-shadow: 0 10px 25px rgba(0,0,0,0.5); margin: auto; }
        h1 { text-align: center; color: var(--primary); font-size: 1.8rem; margin-bottom: 5px; }
        .subtitle { text-align: center; color: #94a3b8; font-size: 0.9rem; margin-bottom: 25px; }
        label { display: block; margin: 15px 0 5px; color: #cbd5e1; font-size: 0.9rem; font-weight: bold; }
        select, input { width: 100%; padding: 12px; background: var(--input-bg); border: 1px solid #475569; color: white; border-radius: 8px; font-size: 1rem; outline: none; transition: 0.2s; }
        select:focus, input:focus { border-color: var(--primary); }
        .password-wrapper { position: relative; }
        .toggle-pass { position: absolute; right: 12px; top: 50%; transform: translateY(-50%); cursor: pointer; color: #94a3b8; font-size: 1.2rem; }
        .btn-submit { margin-top: 30px; width: 100%; background: var(--primary); color: white; padding: 14px; border: none; border-radius: 8px; font-size: 1rem; font-weight: bold; cursor: pointer; box-shadow: 0 4px 6px rgba(59,130,246,0.3); }
        .btn-submit:active { transform: scale(0.98); }
        .helper-text { font-size: 0.75rem; color: #64748b; margin-top: 5px; }
        .step-title { color: var(--primary); border-bottom: 1px solid #334155; padding-bottom: 5px; margin-top: 25px; font-size: 1.1rem; }
    </style>
</head>
<body>
    <div class="container">
        <h1>GateOS Home</h1>
        <p class="subtitle">Assistente de Configuração</p>

        <form action="/save" method="POST">
            
            <div class="step-title">Dados do Proprietário</div>
            <label>E-mail de Registro</label>
            <input type="email" name="email" value="%EMAIL%" placeholder="seu@email.com" required>

            <div class="step-title">Rede Wi-Fi</div>
            <label>Sua Rede (SSID)</label>
            <select name="ssid" required>
                %WIFI_OPTIONS%
            </select>

            <label>Senha do Wi-Fi</label>
            <div class="password-wrapper">
                <input type="password" name="pass" id="passInput" placeholder="Sua senha de internet" required>
                <span class="toggle-pass" onclick="togglePass()"><i class="bi bi-eye-fill"></i><i class="bi bi-eye-slash" style="display: none;"></i></span>
            </div>

            <div class="step-title">Integração Smart Home</div>
            <p class="helper-text" style="margin-bottom: 10px;">Cole abaixo os dados gerados no seu painel Sinric Pro.</p>

            <label>App Key</label>
            <input type="text" name="app_key" value="%APP_KEY%" placeholder="Ex: 8a7b6c5d..." required>

            <label>App Secret</label>
            <input type="text" name="app_secret" value="%APP_SECRET%" placeholder="Ex: 12345678-..." required>

            <label>Device ID</label>
            <input type="text" name="sinric_id" value="%SINRIC_ID%" placeholder="Ex: 5f9e8d7c..." required>

            <button type="submit" class="btn-submit">LIGAR E CONFIGURAR</button>
        </form>
    </div>

    <script>
        function togglePass() {
            const x = document.getElementById("passInput");
            const iconEye = document.querySelector(".toggle-pass i.bi-eye-fill");
            const iconSlash = document.querySelector(".toggle-pass i.bi-eye-slash");
            if (x.type === "password") {
                x.type = "text";
                iconEye.style.display = "none";
                iconSlash.style.display = "inline-block";
            } else {
                x.type = "password";
                iconEye.style.display = "inline-block";
                iconSlash.style.display = "none";
            }
        }
    </script>
</body>
</html>
)rawliteral";

    html.replace("%WIFI_OPTIONS%", opcoesWifi);
    html.replace("%EMAIL%", email_str);
    html.replace("%APP_KEY%", app_key_str);
    html.replace("%APP_SECRET%", app_secret_str);
    html.replace("%SINRIC_ID%", sinric_id_str);

    server.send(200, "text/html; charset=utf-8", html);
  };

  server.on("/", HTTP_GET, pageHandler);
  server.on("/generate_204", HTTP_GET, pageHandler);
  server.on("/gen_204", HTTP_GET, pageHandler);
  server.on("/hotspot-detect.html", HTTP_GET, pageHandler);

  server.onNotFound([=]() {
    if (server.hostHeader() == WiFi.softAPIP().toString()) pageHandler();
    else { server.sendHeader("Location", String("http://") + WiFi.softAPIP().toString(), true); server.send(302, "text/plain", ""); }
  });

  server.on("/save", HTTP_POST, []() {
    if (server.arg("ssid").length() > 0 && server.arg("app_key").length() > 0 && server.arg("app_secret").length() > 0 && server.arg("sinric_id").length() > 0 && server.arg("email").length() > 0) {
      
      guardarConfiguracoes(server.arg("ssid"), server.arg("pass"), server.arg("app_key"), server.arg("app_secret"), server.arg("sinric_id"), server.arg("email"));
      
      // Nova tela de sucesso elegante (sem links externos para não quebrar offline)
      String html = "<html><head><meta charset='UTF-8'><meta name='viewport' content='width=device-width, initial-scale=1'><style>body{background:#0f172a;color:white;font-family:-apple-system,BlinkMacSystemFont,sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;text-align:center;margin:0;padding:20px;} .card{background:#1e293b;padding:30px;border-radius:16px;box-shadow:0 10px 25px rgba(0,0,0,0.5);max-width:400px;width:100%;}</style></head><body><div class='card'><h1 style='color:#10b981;margin-bottom:10px;'>GateOS Configurado!</h1><p style='color:#94a3b8;font-size:0.95rem;margin-bottom:0;'>O seu módulo está reiniciando para se conectar ao seu Wi-Fi residencial. Você já pode fechar esta página.</p></div></body></html>";
      
      server.send(200, "text/html; charset=utf-8", html);
      delay(2000); ESP.restart();
    } else {
      server.send(400, "text/plain", "Faltam dados essenciais. Por favor, preencha todos os campos, incluindo o e-mail.");
    }
  });
  
  server.begin();
}