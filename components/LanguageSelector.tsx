import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select"
import { normalizeLanguageForStorage, formatLanguageForDisplay } from "@/lib/languageUtils"

interface LanguageSelectorProps {
  language: string;
  setLanguage: (language: string) => void;
  options?: string[];
  connectToGuide?: () => void;
  disabled?: boolean;
  loading?: boolean;
  placeholder?: string;
}

/**
 * LanguageSelector Component
 *
 * This component provides a dropdown menu for selecting a language.
 * It uses the shadcn/ui Select component for styling and functionality.
 *
 * Props:
 * - language: The currently selected language
 * - setLanguage: A function to update the selected language
 * - connectToGuide: Function to initiate WebRTC connection
 *
 * The component renders a select input with predefined language options.
 * When a new language is selected, it calls the setLanguage function with the new value,
 * and then calls the connectToGuide function to initiate the WebRTC connection.
 */
export default function LanguageSelector({
  language,
  setLanguage,
  options,
  connectToGuide,
  disabled,
  loading,
  placeholder = "Select language"
}: LanguageSelectorProps) {
  // Default options if none provided
  const languageOptions = options || ["English", "French", "German", "Spanish", "Italian", "Dutch", "Portuguese", "Japanese", "Chinese", "Korean"];

  const handleLanguageChange = (newLanguage: string) => {
    // Normalize the language for storage
    const normalizedLanguage = normalizeLanguageForStorage(newLanguage);
    setLanguage(normalizedLanguage);
    connectToGuide?.(); // Reconnect with the new language
  };

  return (
    <div className="mb-4">
      <Select
        value={language}
        onValueChange={handleLanguageChange}
        disabled={disabled || loading}
      >
        <SelectTrigger className="w-full">
          <SelectValue placeholder={loading ? "Loading..." : placeholder} />
        </SelectTrigger>
        <SelectContent>
          {languageOptions.map((lang) => {
            // For display languages, use as is, but normalize for the value
            const normalizedLang = normalizeLanguageForStorage(lang);
            return (
              <SelectItem key={normalizedLang} value={normalizedLang}>
                {lang}
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
    </div>
  );
}
