interface TranslationOutputProps {
  translation: string
}

/**
 * TranslationOutput Component
 *
 * This component displays the current translation text.
 * It renders the translation in a styled container.
 *
 * Props:
 * - translation: The current translated text to display
 *
 * The component applies styling to make the translation stand out visually.
 */
export default function TranslationOutput({ translation }: TranslationOutputProps) {
  return (
    <div className="mt-4 p-4 bg-gray-100 rounded-lg">
      <p className="text-lg">{translation}</p>
    </div>
  )
}

