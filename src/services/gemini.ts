/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GoogleGenAI } from "@google/genai";
import { Message, AppSettings } from "../types";
import { CapacitorHttp } from '@capacitor/core';

// Helper to sanitize API endpoint
function sanitizeEndpoint(endpoint: string): string {
  let sanitized = endpoint.trim();
  if (!sanitized.startsWith('http')) {
    sanitized = `http://${sanitized}`;
  }
  // Ensure it ends with /v1 for LM Studio compatibility
  if (!sanitized.endsWith('/v1') && !sanitized.endsWith('/v1/')) {
    sanitized = `${sanitized.replace(/\/$/, '')}/v1`;
  }
  return sanitized;
}

export async function sendMessageToGemini(
  messages: Message[],
  settings: AppSettings,
  onChunk?: (chunk: string) => void
) {
  try {
    if (settings.apiEndpoint) {
      const sanitizedEndpoint = sanitizeEndpoint(settings.apiEndpoint);
      const url = `${sanitizedEndpoint}/chat/completions`;
      console.log("Attempting to connect to API endpoint:", url);
      
      const history = messages.slice(0, -1).map(msg => ({
        role: msg.role === 'assistant' ? 'assistant' : 'user',
        content: msg.content
      }));

      const lastMessage = messages[messages.length - 1];

      // Use CapacitorHttp for better compatibility and to bypass CORS on mobile
      const options = {
        url: url,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${settings.apiKey || "lm-studio"}`
        },
        data: {
          model: settings.modelName || "local-model",
          messages: [
            ...history,
            { role: 'user', content: lastMessage.content }
          ],
          stream: false,
        },
        connectTimeout: 30000,
        readTimeout: 60000
      };

      const response = await CapacitorHttp.request(options);

      if (response.status < 200 || response.status >= 300) {
        console.error("API Response Error:", response);
        throw new Error(`API 请求失败: ${response.status} ${response.data?.error?.message || ''}`);
      }

      const fullText = response.data.choices[0]?.message?.content || "";
      
      if (fullText) {
        onChunk?.(fullText);
      }
      
      return fullText;
    }

    // Use GoogleGenAI client
    const ai = new GoogleGenAI({ 
      apiKey: settings.apiKey || process.env.GEMINI_API_KEY || "",
      baseUrl: settings.apiEndpoint || undefined
    } as any);

    const history = messages.slice(0, -1).map(msg => ({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: msg.content }]
    }));

    const lastMessage = messages[messages.length - 1];
    const parts: any[] = [{ text: lastMessage.content }];

    if (lastMessage.type === 'image' && lastMessage.mediaUrl) {
      const base64Data = lastMessage.mediaUrl.split(',')[1];
      const mimeType = lastMessage.mediaUrl.split(';')[0].split(':')[1];
      parts.push({
        inlineData: {
          data: base64Data,
          mimeType: mimeType
        }
      });
    }

    const responseStream = await ai.models.generateContentStream({
      model: settings.modelName || "gemini-1.5-flash",
      contents: [
        ...history,
        { role: 'user', parts }
      ],
      config: {
        systemInstruction: settings.systemInstruction || `你是 ${settings.aiName}，一个乐于助人的 AI 助手。请用中文回答。保持回答简洁并适合移动端阅读。使用 markdown 格式。`,
        tools: [{ googleSearch: {} }],
      }
    });

    let fullText = "";
    for await (const chunk of responseStream) {
      const text = chunk.text;
      if (text) {
        fullText += text;
        onChunk?.(text);
      }
    }

    return fullText;
  } catch (error) {
    console.error("API Error:", error);
    if (error instanceof Error) {
      if (error.message.includes('fetch') || error.message.includes('network') || error.message.includes('Failed to fetch')) {
        throw new Error("网络连接错误，请检查您的网络设置、API 端点配置，或确保安卓应用已开启明文 HTTP 请求权限。");
      }
      throw new Error(`API 错误: ${error.message}`);
    }
    throw new Error("发生未知错误，请稍后再试。");
  }
}
