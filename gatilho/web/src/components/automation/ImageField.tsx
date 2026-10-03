import { ImageUp, X } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { api, errorMessage } from "../../lib/api";
import { Button, Input } from "../ui";

/** Campo de imagem: URL pública ou envio de arquivo (JPG, PNG, GIF, WEBP até 8 MB). */
export function ImageField({ value, onChange, invalid }: { value: string; onChange: (v: string) => void; invalid?: boolean }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const upload = async (file: File) => {
    if (file.size > 8 * 1024 * 1024) {
      toast.error("A imagem deve ter no máximo 8 MB.");
      return;
    }
    setUploading(true);
    try {
      const dataBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("Não foi possível ler o arquivo."));
        reader.readAsDataURL(file);
      });
      const { media } = await api.post<{ media: { url: string } }>("/media", { filename: file.name, dataBase64 });
      onChange(media.url);
      toast.success("Imagem enviada");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder="https://… (URL pública da imagem)" invalid={invalid} />
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/gif,image/webp" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
        <Button variant="secondary" icon={<ImageUp className="size-4" />} loading={uploading} onClick={() => fileRef.current?.click()}>
          Enviar
        </Button>
      </div>
      {value && /^https?:\/\//.test(value) && (
        <div className="relative w-fit">
          <img src={value} alt="Pré-visualização" className="max-h-32 rounded-lg ring-1 ring-zinc-200" />
          <button type="button" onClick={() => onChange("")} className="absolute -top-2 -right-2 rounded-full bg-white p-0.5 shadow ring-1 ring-zinc-200" aria-label="Remover imagem">
            <X className="size-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}
