import React, { useCallback, useRef } from 'react';
import { Upload, FileImage, Plus } from 'lucide-react';

interface DropZoneProps {
  onImagesSelected: (base64s: string[]) => void;
  compact?: boolean;
}

export const DropZone: React.FC<DropZoneProps> = ({ onImagesSelected, compact = false }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback((files: FileList | File[]) => {
    const validFiles = Array.from(files).filter(f => f.type.startsWith('image/'));
    
    if (validFiles.length === 0) return;

    const promises = validFiles.map(file => {
        return new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                if (e.target?.result && typeof e.target.result === 'string') {
                    resolve(e.target.result);
                }
            };
            reader.readAsDataURL(file);
        });
    });

    Promise.all(promises).then(images => {
        onImagesSelected(images);
    });
  }, [onImagesSelected]);

  const onDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files);
    }
  }, [handleFiles]);

  const onDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
  }, []);

  const onClick = () => {
    fileInputRef.current?.click();
  };

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFiles(e.target.files);
    }
    // Reset input so same file can be selected again if needed
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  if (compact) {
      return (
        <div 
            onClick={onClick}
            onDrop={onDrop}
            onDragOver={onDragOver}
            className="w-full h-24 border-2 border-dashed border-secondary/30 rounded-xl flex flex-col items-center justify-center cursor-pointer hover:border-primary hover:bg-surface/50 transition-all group"
        >
             <input
                type="file"
                ref={fileInputRef}
                onChange={onInputChange}
                className="hidden"
                accept="image/*"
                multiple
            />
            <Plus className="w-6 h-6 text-secondary group-hover:text-primary mb-1" />
            <span className="text-xs text-secondary">Add Signatures</span>
        </div>
      )
  }

  return (
    <div
      onClick={onClick}
      onDrop={onDrop}
      onDragOver={onDragOver}
      className="w-full h-64 border-2 border-dashed border-secondary/50 rounded-2xl flex flex-col items-center justify-center cursor-pointer hover:border-primary hover:bg-surface/50 transition-all group"
    >
      <input
        type="file"
        ref={fileInputRef}
        onChange={onInputChange}
        className="hidden"
        accept="image/*"
        multiple
      />
      <div className="p-4 bg-surface rounded-full mb-4 group-hover:scale-110 transition-transform">
        <Upload className="w-8 h-8 text-primary" />
      </div>
      <h3 className="text-lg font-medium text-gray-200">Upload Signatures</h3>
      <p className="text-sm text-gray-400 mt-2">Drag & drop multiple files or click to browse</p>
      <p className="text-xs text-gray-500 mt-1">Supports PNG, JPG, JPEG</p>
    </div>
  );
};