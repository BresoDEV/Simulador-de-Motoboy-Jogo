# Cidade Sem Fim — Alpha 1.0

Esta versão parte diretamente da 1.7.1 (câmera suave, mapa, oficinas e lojas), com as funcionalidades abaixo.

## Instalação
1. Guarde seu ZIP da 1.7.1 como backup.
2. Substitua `index.html`, `main.js` e `styles.css` no seu GitHub Pages.
3. **Se seu `config.js` tem texturas próprias, preserve-o.** Adicione ao final as variáveis de som apresentadas abaixo. Caso ainda não tenha feito personalizações, pode usar o `config.js` do ZIP.
4. Coloque os arquivos de áudio na pasta `sons/`, publique e recarregue a página com Ctrl+Shift+R.

## Menu secreto de desenvolvedor
- **Celular:** no menu principal, toque **7 vezes rapidamente em CIDADE SEM FIM**. O painel DEV abre e aparece um pequeno botão DEV durante a partida. O desbloqueio não é persistente.
- **Computador:** tecla **F9** ou, no console do navegador, execute apenas `DEVMENU()`.
- Opções: teleporte ao restaurante/oficina mais próximos; teleporte para uma propriedade comprada; spawn temporário de Compacto/Sedã/SUV/Van; alterar hora e clima; adicionar dinheiro; salvar.
- Teleportes se baseiam nos pontos conhecidos pelo jogo. Imóveis comprados podem ser encontrados pelo save da seed. Quando não há ponto conhecido ou lugar livre, o painel avisa.
- O carro de teste **não** entra na lista de veículos comprados; o dinheiro injetado **é salvo** na seed.
- É uma ferramenta de desenvolvimento escondida na interface, **não** um sistema de segurança contra inspeção do código JavaScript.

## Sistema de entregas por reputação
- **0 a 9 entregas concluídas:** o funcionamento é o original, um destino sorteado por pedido.
- **A partir de 10 entregas:** ao coletar no restaurante, surge uma lista de até três ofertas conforme os destinos conhecidos: curta, média e longa. Cada uma informa a distância e o pagamento correspondente.
- Não existe cronômetro obrigatório. Todas as recompensas ainda usam a fórmula de distância em `config.js`.
- Progresso e reputação são separados por seed e mantêm compatibilidade com o save anterior.

## Clima
- No menu principal: Automático, Ensolarado, Nublado, Chuva ou Neblina.
- No DEV: o clima muda de imediato, com uma transição visual gradual.
- Chuva usa linhas/partículas 3D leves (menos partículas em celulares), e neblina altera a visibilidade. O clima automático escolhe condições por períodos de quatro horas do relógio do jogo.
- O clima selecionado é gravado no save por seed.
- Não implementamos semáforos nesta versão, pois o trânsito atual depende de curvas e cruzamentos procedurais. Essa mudança merece uma atualização isolada para testes.

## Áudio de ambiente
No `config.js`:
```javascript
export var somAmbiente = "sons/ambiente.mp3";
export var somAmbienteCidade = "sons/cidade.mp3";    // opcional
export var somAmbienteFloresta = "sons/floresta.mp3"; // opcional
export var volumeAmbiente = 0.28;
```
- Deixe qualquer caminho `""` para usar o arquivo geral como fallback. Se todos estiverem vazios, não toca nada.
- O som toca em loop ao clicar em **JOGAR** e pausa no menu. Navegadores podem bloquear áudio se o usuário não tiver interagido com a página.
- **Não incluí arquivos de áudio de terceiros**: use gravações próprias ou sons com licença apropriada.

## Floresta levemente ondulada
- Nos lotes de floresta, a elevação procedural varia entre 0 e **50 cm**.
- Ruas e áreas urbanas permanecem planas; personagem e carro acompanham o relevo ao sair das vias.
- As texturas configuradas previamente continuam disponíveis; o relevo é gerado por seed.

## Testes executados
- Verificação de sintaxe JavaScript, arquivos e estrutura de interface.
- Testes isolados: limites do relevo, oferta de três distâncias em mapa com destinos conhecidos, regras do menu DEV, som configurável e clima instantâneo.
- **Limitação:** não foi possível abrir o renderizador WebGL no navegador de testes deste ambiente; a experiência 3D e os controles touch devem ser confirmados no seu navegador antes de substituir a cópia estável.

## Recomendações rápidas
Teste com a seed `CLT-2026`: inicie, pressione F9, mude o clima para chuva, salve, feche e reabra; teste teleporte para restaurante e spawn de carro. Para testar a reputação após 10 entregas, complete 10 pedidos ou use uma seed que já tenha esse número no save.
