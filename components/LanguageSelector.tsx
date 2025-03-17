import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select"

interface LanguageSelectorProps {
  language: string;
  setLanguage: (language: string) => void;
  options?: string[];
  connectToGuide: () => void; // Add connectToGuide prop
  disabled?: boolean; // Optional disabled prop
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
export default function LanguageSelector({ language, setLanguage, options, connectToGuide }: LanguageSelectorProps) {
  // Default options if none provided - using languages supported by OpenAI Realtime API
  const languageOptions = options || ["English", "French", "German", "Spanish", "Italian", "Dutch", "Portuguese", "Japanese", "Chinese", "Korean"];

  const handleLanguageChange = (newLanguage: string) => {
    setLanguage(newLanguage);
    connectToGuide(); // Reconnect with the new language
  };
  
  return (
    <div className="mb-4">
      <Select value={language} onValueChange={handleLanguageChange}>
        <SelectTrigger className="w-[180px]">
          <SelectValue placeholder="Select language" />
        </SelectTrigger>
        <SelectContent>
          {languageOptions.map((lang) => (
            <SelectItem key={lang} value={lang}>{lang}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
