/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useCallback, useEffect } from 'react';
import { VoiceRecorder } from 'capacitor-voice-recorder';

export function useVoiceRecorder() {
  const [isRecording, setIsRecording] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);

  useEffect(() => {
    // Request permissions on mount
    VoiceRecorder.requestAudioRecordingPermission().catch(() => {});
  }, []);

  const startRecording = useCallback(async () => {
    try {
      const { value } = await VoiceRecorder.canDeviceVoiceRecord();
      if (!value) {
        console.error('This device cannot record voice');
        return;
      }

      const { value: hasPermission } = await VoiceRecorder.hasAudioRecordingPermission();
      if (!hasPermission) {
        const { value: requested } = await VoiceRecorder.requestAudioRecordingPermission();
        if (!requested) {
          console.error('Permission denied');
          return;
        }
      }

      await VoiceRecorder.startRecording();
      setIsRecording(true);
      setAudioUrl(null);
    } catch (err) {
      console.error('Failed to start recording', err);
    }
  }, []);

  const stopRecording = useCallback(async () => {
    try {
      const result = await VoiceRecorder.stopRecording();
      setIsRecording(false);
      
      if (result.value && result.value.recordDataBase64) {
        // Create a data URL from base64
        const mimeType = result.value.mimeType || 'audio/webm';
        const dataUrl = `data:${mimeType};base64,${result.value.recordDataBase64}`;
        setAudioUrl(dataUrl);
      }
    } catch (err) {
      console.error('Failed to stop recording', err);
      setIsRecording(false);
    }
  }, []);

  useEffect(() => {
    return () => {
      // Emergency stop on unmount
      VoiceRecorder.getCurrentStatus().then(({ status }) => {
        if (status === 'RECORDING') {
          VoiceRecorder.stopRecording().catch(() => {});
        }
      }).catch(() => {});
    };
  }, []);

  return {
    isRecording,
    audioUrl,
    startRecording,
    stopRecording,
    setAudioUrl
  };
}
