import React, {useState} from 'react';
import {Download, X} from 'lucide-react';
import {usePWAInstall} from '../hooks/usePWAInstall';

export const PWAInstallButton: React.FC = () => {
  const {isInstallable, isInstalled, isIOS, install} = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={() => void install()}
        className="min-h-[36px] px-3 py-1.5 rounded-lg bg-[#D99B26] text-[#111310] text-xs font-semibold flex items-center gap-1.5 hover:bg-[#E5AA38] active:scale-[0.98] transition-all whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-[#D99B26]"
      >
        <Download className="w-4 h-4 shrink-0" aria-hidden="true" />
        <span>Install</span>
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowIOSGuide(true)}
          className="min-h-[36px] px-3 py-1.5 rounded-lg border border-[#4E5A3E] bg-[#1B1E18] text-[#E6E8E1] text-xs font-medium flex items-center gap-1.5 hover:bg-[#252920] whitespace-nowrap shrink-0"
        >
          <Download className="w-4 h-4 shrink-0 text-[#D99B26]" aria-hidden="true" />
          <span>Install</span>
        </button>

        {showIOSGuide && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
            <div className="w-full max-w-sm rounded-xl border border-[#32382B] bg-[#1B1E18] p-5 text-[#E6E8E1]">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-display text-lg font-bold tracking-wide">
                  Install Vanguard Mesh
                </h3>
                <button
                  type="button"
                  onClick={() => setShowIOSGuide(false)}
                  className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-[#9AA28E] hover:text-[#E6E8E1]"
                  aria-label="Close install instructions"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <p className="text-sm text-[#9AA28E] leading-relaxed">
                1. Tap the <strong className="text-[#E6E8E1]">Share</strong> icon in Safari.
                <br />
                2. Scroll down and select <strong className="text-[#E6E8E1]">Add to Home Screen</strong> for full offline PWA support.
              </p>
              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="mt-4 w-full min-h-[44px] rounded-lg bg-[#4E5A3E] text-[#E6E8E1] text-sm font-medium hover:bg-[#5B6949]"
              >
                Done
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
};
