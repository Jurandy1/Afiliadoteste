export default function SettingsPage() {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6 max-w-lg">
      <h3 className="text-sm font-semibold text-gray-900 mb-2">Configurações</h3>
      <p className="text-xs text-gray-500 mb-4">
        AffiliateHub Pro — estrutura modular. Firebase e importações estão ativos; autenticação e preferências avançadas virão aqui.
      </p>
      <dl className="text-xs space-y-2 text-gray-600">
        <div className="flex justify-between border-b border-gray-100 pb-2">
          <dt>Versão</dt>
          <dd className="font-medium text-gray-800">1.0</dd>
        </div>
        <div className="flex justify-between border-b border-gray-100 pb-2">
          <dt>Hosting</dt>
          <dd className="font-medium text-gray-800">Vercel</dd>
        </div>
        <div className="flex justify-between pb-2">
          <dt>Banco</dt>
          <dd className="font-medium text-gray-800">Firestore</dd>
        </div>
      </dl>
    </div>
  );
}
