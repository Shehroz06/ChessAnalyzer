export default function LoadingSpinner({ message = 'Analyzing…' }) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-16">
      <div className="relative w-16 h-16">
        <div className="absolute inset-0 border-4 border-gray-700 rounded-full" />
        <div className="absolute inset-0 border-4 border-t-blue-500 rounded-full animate-spin" />
        <span className="absolute inset-0 flex items-center justify-center text-2xl">♟</span>
      </div>
      <p className="text-gray-400 text-sm">{message}</p>
    </div>
  );
}
