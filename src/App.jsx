import React, { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';

// テーマカラー設定
const THEME_COLORS = {
  SAA: '#FF9500',      // オレンジ
  SOA: '#30D158',      // グリーン (CloudOps)
  SCS: '#0A84FF',      // ブルー
  SAP: '#BF5AF2'       // パープル
};

const CERT_NAMES = {
  SAA: 'AWS Certified Solutions Architect - Associate',
  SOA: 'AWS Certified CloudOps Engineer - Associate',
  SCS: 'AWS Certified Security - Specialty',
  SAP: 'AWS Certified Solutions Architect - Professional'
};

// --- Storage & Level Logic ---
const STORAGE_KEY = 'aws-study-records';

export const getStorage = async () => {
  if (typeof window !== 'undefined' && window.storage) {
    const data = await window.storage.get(STORAGE_KEY);
    return data ? JSON.parse(data) : { answers: [], sessions: [] };
  } else {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : { answers: [], sessions: [] };
  }
};

export const setStorage = async (data) => {
  if (typeof window !== 'undefined' && window.storage) {
    await window.storage.set(STORAGE_KEY, JSON.stringify(data));
  } else {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }
};

export const calcLevel = (answers, cert) => {
  if (!answers || answers.length === 0) return 1;
  const targetAnswers = answers.filter(a => a.cert === cert).sort((a, b) => b.timestamp - a.timestamp).slice(0, 20);
  
  if (targetAnswers.length === 0) return 1;

  const correctCount = targetAnswers.filter(a => a.correct).length;
  const accuracy = correctCount / targetAnswers.length;
  const avgDiff = targetAnswers.reduce((sum, a) => sum + a.difficulty, 0) / targetAnswers.length;

  if (accuracy >= 0.8 && avgDiff >= 4) return 5;
  if (accuracy >= 0.75 && avgDiff >= 3) return 4;
  if (accuracy >= 0.65) return 3;
  if (accuracy >= 0.5) return 2;
  return 1;
};

export const getCertStats = (answers, cert) => {
  if (!answers) return { total: 0, correct: 0, accuracy: 0, topics: {} };
  
  const certAnswers = answers.filter(a => a.cert === cert);
  if (certAnswers.length === 0) return { total: 0, correct: 0, accuracy: 0, topics: {} };

  const correct = certAnswers.filter(a => a.correct).length;
  const topics = {};
  
  certAnswers.forEach(a => {
    if (!topics[a.topic]) topics[a.topic] = { total: 0, correct: 0 };
    topics[a.topic].total++;
    if (a.correct) topics[a.topic].correct++;
  });

  return {
    total: certAnswers.length,
    correct,
    accuracy: Math.round((correct / certAnswers.length) * 100),
    topics
  };
};

export const TOPICS = {
  SAA: ['Compute', 'Storage', 'Database', 'Security', 'Networking'],
  SOA: ['Monitoring', 'Deployment', 'Security', 'Reliability', 'Operations'],
  SCS: ['Incident Response', 'Logging & Monitoring', 'Infrastructure Security', 'IAM', 'Data Protection'],
  SAP: ['Migration', 'Cost Control', 'Continuous Improvement', 'Security', 'Architecture']
};

export const callClaude = async (systemPrompt, messages, isChat = false) => {
  try {
    const apiKey = typeof window !== 'undefined' ? localStorage.getItem('aws-study-api-key') : null;
    const modelName = (typeof window !== 'undefined' ? localStorage.getItem('aws-study-api-model') : null) || 'claude-3-haiku-20240307';
    
    const headers = {
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
      'anthropic-dangerous-direct-browser-access': 'true'
    };
    if (apiKey) {
      headers['x-api-key'] = apiKey;
    }

    // Localhost(Vite)環境ではCORSエラーを防ぐため設定したプロキシ経由で送信する
    const isLocalhost = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
    const endpoint = isLocalhost ? '/api/anthropic/v1/messages' : 'https://api.anthropic.com/v1/messages';

    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: modelName,
        max_tokens: 1000,
        system: systemPrompt,
        messages: messages,
      })
    });
    
    if (!response.ok) {
      const errText = await response.text();
      console.error("Anthropic API Error:", response.status, errText);
      throw new Error(`API Error ${response.status}: ${errText}`);
    }
    
    const data = await response.json();
    return data.content[0].text;
  } catch (error) {
    console.warn("API call failed, using mock data.", error.message);
    const errMessage = error.message.replace(/"/g, "'").substring(0, 100);
    if (isChat) {
      return `[Mock] API通信エラー (${errMessage})。正常に設定されると、ご質問「${messages[messages.length - 1]?.content.substring(0, 15)}...」についての回答が出力されます。`;
    }
    return `{"type":"quiz","question":"[Mock: ${errMessage}] IAMロールに関する問題です。EC2インスタンスからS3バケットにアクセスする際、最も安全な方法はどれですか？","options":["アクセスキーをソースコードにハードコーディングする","環境変数にアクセスキーを設定する","IAMロールを作成しEC2インスタンスにアタッチする","IAMユーザーの認証情報をインスタンス内に保存する"],"correct":2,"explanation":"API呼び出しに失敗したためモックを表示しています。エラー原因: ${errMessage}","difficulty":3,"topic":"Security"}`;
  }
};

const App = () => {
  // --- States ---
  const [activeCert, setActiveCert] = useState('SAA');
  const [view, setView] = useState('home'); // 'home' | 'quiz' | 'chat' | 'stats' | 'help'
  const [apiKeyInput, setApiKeyInput] = useState(() => typeof window !== 'undefined' ? localStorage.getItem('aws-study-api-key') || '' : '');
  const [apiModelInput, setApiModelInput] = useState(() => typeof window !== 'undefined' ? localStorage.getItem('aws-study-api-model') || 'claude-3-haiku-20240307' : 'claude-3-haiku-20240307');
  const [records, setRecords] = useState({ answers: [], sessions: [] });
  const [level, setLevel] = useState(1);
  const [loadingStorage, setLoadingStorage] = useState(true);
  
  const [quiz, setQuiz] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [selected, setSelected] = useState(null);
  const [answered, setAnswered] = useState(false);

  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [currentAnswerId, setCurrentAnswerId] = useState(null);
  const chatBottomRef = useRef(null);

  // --- Quiz Logic ---
  const generateQuiz = async (cert, currentLevel) => {
    setGenerating(true);
    setQuiz(null);
    setSelected(null);
    setAnswered(false);
    setChatMessages([]);
    setCurrentAnswerId(null);
    
    const topicsSeq = TOPICS[cert] || ['General'];
    const randomTopic = topicsSeq[Math.floor(Math.random() * topicsSeq.length)];
    const systemPrompt = "あなたはAWS認定資格の熟練コーチです。クイズは必ず提供されたJSONフォーマット通りに出力してください。Markdownブロックは使用せず、純粋なJSONテキストのみを返してください。";
    const userPrompt = `${CERT_NAMES[cert]}の「${randomTopic}」に関する難易度${currentLevel}/5の4択クイズを出題してください。
以下のJSON形式のみで返してください：
{
  "type": "quiz",
  "question": "問題文",
  "options": ["選択肢A", "選択肢B", "選択肢C", "選択肢D"],
  "correct": 0,
  "explanation": "解説文(200文字程度)",
  "difficulty": ${currentLevel},
  "topic": "${randomTopic}"
}`;

    const resText = await callClaude(systemPrompt, [{ role: 'user', content: userPrompt }]);
    try {
      const cleanJson = resText.replace(/```json/g, '').replace(/```/g, '').trim();
      const quizData = JSON.parse(cleanJson);
      setQuiz(quizData);
    } catch (e) {
      console.error("JSON parse error:", e);
      setQuiz({
        type: "quiz", question: "問題の生成に失敗しました。ローカル環境等によるAPI通信エラーの可能性があります。",
        options: ["-", "-", "-", "-"], correct: 0, explanation: "Parse Error Occurred.",
        difficulty: currentLevel, topic: randomTopic
      });
    } finally {
      setGenerating(false);
    }
  };

  const submitAnswer = async (idx) => {
    if (answered) return;
    setSelected(idx);
    setAnswered(true);

    const isCorrect = idx === quiz.correct;
    const newAnswerRecord = {
      id: Date.now().toString(),
      cert: activeCert,
      topic: quiz.topic,
      correct: isCorrect,
      difficulty: quiz.difficulty,
      timestamp: Date.now(),
      quizData: quiz,
      userAnswer: idx,
      discussion: []
    };
    
    setCurrentAnswerId(newAnswerRecord.id);

    const baseRecords = records || { answers: [], sessions: [] };
    const newRecords = { ...baseRecords, answers: [...(baseRecords.answers || []), newAnswerRecord] };
    
    setRecords(newRecords);
    await setStorage(newRecords);
  };

  // --- Chat Logic ---
  const sendChat = async (textOverride = null) => {
    const text = textOverride !== null ? textOverride : chatInput;
    if (!text.trim() || chatLoading) return;

    const newUserMsg = { role: 'user', content: text };
    const newMessages = [...chatMessages, newUserMsg];
    setChatMessages(newMessages);
    setChatInput('');
    setChatLoading(true);

    const systemPrompt = `あなたはAWS認定資格（${CERT_NAMES[activeCert]} - Lv${level}学習者向け）の熟練コーチです。簡潔かつ分かりやすく、日本語で回答してください。`;

    // Inject quiz context into the first prompt if available
    const apiMessages = [...newMessages];
    if (quiz && apiMessages.length > 0) {
      apiMessages[0] = {
        role: 'user',
        content: `【現在の問題コンテキスト】\n問題: ${quiz.question}\nユーザーは「${quiz.options[selected !== null ? selected : 0]}」を選択しました。\n正解は「${quiz.options[quiz.correct]}」です。\n\nユーザーの質問: ${apiMessages[0].content}`
      };
    }

    const responseText = await callClaude(systemPrompt, apiMessages, true);
    const updatedMessages = [...newMessages, { role: 'assistant', content: responseText }];
    setChatMessages(updatedMessages);
    setChatLoading(false);

    if (currentAnswerId) {
      setRecords(prev => {
        const answers = prev.answers.map(ans => 
          ans.id === currentAnswerId ? { ...ans, discussion: updatedMessages } : ans
        );
        const newRecords = { ...prev, answers };
        setStorage(newRecords);
        return newRecords;
      });
    }
  };

  // --- Export Logic ---
  const exportToMarkdown = () => {
    let md = `# AWS Certification Study Reference Book\n\n`;
    md += `*Generated on: ${new Date().toLocaleString()}*\n\n`;
    
    md += `## 📊 総合統計 (Global Stats)\n\n`;
    const certs = Object.keys(THEME_COLORS);
    certs.forEach(cert => {
      const certAns = records.answers.filter(a => a.cert === cert);
      const total = certAns.length;
      const correct = certAns.filter(a => a.correct).length;
      const acc = total > 0 ? Math.round((correct/total)*100) : 0;
      md += `- **${cert}**: 正答率 ${acc}% (${correct}/${total}問)\n`;
    });
    md += `\n`;
    
    md += `## 📝 学習ログ & ディスカッション\n\n`;
    
    const validAnswers = records.answers.filter(a => a.quizData);
    if (validAnswers.length === 0) {
      md += `*学習ログ（問題と解説付き）がまだありません。これからの学習履歴がここに保存されます。*\n\n`;
    } else {
      validAnswers.forEach((ans, idx) => {
        const q = ans.quizData;
        const dateStr = new Date(ans.timestamp).toLocaleString();
        
        md += `### Q${idx + 1}. [${ans.cert}] ${ans.topic} (Lv.${ans.difficulty})\n`;
        md += `*日時: ${dateStr}*\n\n`;
        
        md += `**問題:**\n${q.question}\n\n`;
        md += `**選択肢:**\n`;
        q.options.forEach((opt, oIdx) => {
          const isCorrect = oIdx === q.correct;
          const isUser = oIdx === ans.userAnswer;
          let mark = '- [ ]';
          if (isCorrect) mark = '- [✅]';
          let line = `${mark} ${opt}`;
          if (isUser && !isCorrect) line += ` 🔴 (Your Answer)`;
          if (isUser && isCorrect) line += ` ⭐ (Your Answer)`;
          md += `${line}\n`;
        });
        md += `\n**AI解説:**\n${q.explanation}\n\n`;
        
        if (ans.discussion && ans.discussion.length > 0) {
          md += `**🗣️ ディスカッション履歴:**\n\n`;
          ans.discussion.forEach(msg => {
            const role = msg.role === 'user' ? '👤 ユーザー' : '🤖 AIコーチ';
            if (msg.role === 'user' || msg.role === 'assistant') {
              md += `**${role}**:\n${msg.content}\n\n`;
            }
          });
        }
        md += `---\n\n`;
      });
    }
    
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'aws_study_reference.md');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };


  // --- Effects ---
  useEffect(() => {
    let mounted = true;
    const initStorage = async () => {
      try {
        const data = await getStorage();
        if (mounted) {
          setRecords(data);
          setLoadingStorage(false);
        }
      } catch (e) {
        console.error("Storage load failed", e);
        if (mounted) setLoadingStorage(false);
      }
    };
    initStorage();
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (records && records.answers) {
      setLevel(calcLevel(records.answers, activeCert));
    }
  }, [records, activeCert]);

  useEffect(() => {
    if (chatBottomRef.current) {
      chatBottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chatMessages, chatLoading, view]);

  // --- Styles ---
  const baseLayoutStyle = {
    backgroundColor: '#0a0a0f',
    color: '#ffffff',
    minHeight: '100vh',
    fontFamily: 'monospace',
    margin: 0,
    padding: 0,
    boxSizing: 'border-box'
  };

  const containerStyle = {
    maxWidth: '800px',
    margin: '0 auto',
    padding: '20px',
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column'
  };

  const headerStyle = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottom: '1px solid #333',
    paddingBottom: '15px',
    marginBottom: '20px',
    flexWrap: 'wrap',
    gap: '10px'
  };

  const titleStyle = {
    fontSize: '24px',
    fontWeight: 'bold',
    margin: 0
  };

  const certTabsStyle = {
    display: 'flex',
    gap: '10px',
    flexWrap: 'wrap'
  };

  const getTabStyle = (cert) => ({
    padding: '8px 12px',
    borderRadius: '4px',
    cursor: 'pointer',
    backgroundColor: activeCert === cert ? THEME_COLORS[cert] : '#222',
    color: activeCert === cert ? '#fff' : '#aaa',
    border: 'none',
    fontWeight: activeCert === cert ? 'bold' : 'normal',
    transition: 'background-color 0.2s',
    fontFamily: 'monospace'
  });

  const navBarStyle = {
    display: 'flex',
    gap: '15px',
    marginBottom: '30px',
    borderBottom: '1px solid #333',
    paddingBottom: '10px',
    flexWrap: 'wrap'
  };

  const getNavStyle = (navView) => ({
    cursor: 'pointer',
    color: view === navView ? THEME_COLORS[activeCert] : '#aaa',
    fontWeight: view === navView ? 'bold' : 'normal',
    textDecoration: view === navView ? 'underline' : 'none',
    textUnderlineOffset: '8px',
    textDecorationThickness: '2px',
    transition: 'color 0.2s'
  });

  const contentAreaStyle = {
    flex: 1,
    backgroundColor: '#111116',
    borderRadius: '8px',
    padding: '20px',
    border: '1px solid #333'
  };

  // --- Render Helpers ---
  const renderViewContent = () => {
    switch(view) {
      case 'home': {
        const stats = getCertStats(records?.answers, activeCert);
        return (
          <div style={{ padding: '10px' }}>
            <h2 style={{ color: THEME_COLORS[activeCert], marginBottom: '15px', marginTop: 0 }}>
              {CERT_NAMES[activeCert]}
            </h2>
            
            {/* Stats Overview */}
            <div style={{ display: 'flex', gap: '20px', backgroundColor: '#222', padding: '15px', borderRadius: '8px', marginBottom: '20px', flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 auto', minWidth: '100px' }}>
                <div style={{ color: '#aaa', fontSize: '12px' }}>LEVEL</div>
                <div style={{ fontSize: '28px', fontWeight: 'bold', color: THEME_COLORS[activeCert] }}>{level}</div>
              </div>
              <div style={{ flex: '1 1 auto', minWidth: '100px' }}>
                <div style={{ color: '#aaa', fontSize: '12px' }}>ANSWERS</div>
                <div style={{ fontSize: '28px', fontWeight: 'bold' }}>{stats.total}</div>
              </div>
              <div style={{ flex: '1 1 auto', minWidth: '100px' }}>
                <div style={{ color: '#aaa', fontSize: '12px' }}>ACCURACY</div>
                <div style={{ fontSize: '28px', fontWeight: 'bold' }}>{stats.total > 0 ? stats.accuracy + '%' : '-'}</div>
              </div>
            </div>

            {/* Level Progress */}
            <div style={{ marginBottom: '30px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                <span style={{ fontSize: '14px', color: '#aaa' }}>Current Level Progress</span>
                <span style={{ fontSize: '14px', color: THEME_COLORS[activeCert], fontWeight: 'bold' }}>{level * 20}%</span>
              </div>
              <div style={{ height: '10px', backgroundColor: '#333', borderRadius: '5px', overflow: 'hidden' }}>
                <div style={{ 
                  height: '100%', 
                  width: `${level * 20}%`, 
                  backgroundColor: THEME_COLORS[activeCert], 
                  transition: 'width 0.5s ease',
                  borderRadius: '5px'
                }} />
              </div>
            </div>

            {/* Start Quiz Button */}
            <button 
              onClick={() => setView('quiz')}
              style={{
                width: '100%', padding: '15px', backgroundColor: THEME_COLORS[activeCert], color: '#fff', fontSize: '18px', fontWeight: 'bold',
                border: 'none', borderRadius: '8px', cursor: 'pointer', marginBottom: '40px', transition: 'opacity 0.2s'
              }}
              onMouseOver={(e) => e.target.style.opacity = 0.8}
              onMouseOut={(e) => e.target.style.opacity = 1}
            >
              クイズを開始する
            </button>

            {/* Topic Masteries */}
            <h3 style={{ borderBottom: '1px solid #333', paddingBottom: '10px', marginBottom: '15px' }}>トピック習熟度</h3>
            {Object.keys(stats.topics).length === 0 ? (
              <div style={{ color: '#888', fontStyle: 'italic', textAlign: 'center', padding: '20px', backgroundColor: '#222', borderRadius: '8px' }}>
                クイズを開始すると、トピックごとの正解率がここに表示されます。
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '15px' }}>
                {Object.entries(stats.topics).map(([topicName, tStats]) => {
                  const tAcc = Math.round((tStats.correct / tStats.total) * 100);
                  const color = tAcc >= 80 ? '#30D158' : tAcc >= 50 ? '#FF9500' : '#FF453A';
                  return (
                    <div key={topicName} style={{ backgroundColor: '#222', padding: '15px', borderRadius: '8px', borderLeft: `4px solid ${color}` }}>
                      <div style={{ fontSize: '14px', fontWeight: 'bold', marginBottom: '8px' }}>{topicName}</div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
                        <span style={{ color: '#aaa' }}>{tStats.correct} / {tStats.total}</span>
                        <span style={{ color, fontWeight: 'bold' }}>{tAcc}%</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Roadmap */}
            <h3 style={{ borderBottom: '1px solid #333', paddingBottom: '10px', marginTop: '40px', marginBottom: '15px' }}>キャリアロードマップ</h3>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
              {['SAA', 'SOA', 'SCS', 'SAP'].map((cert, idx) => (
                <React.Fragment key={cert}>
                  <div 
                    onClick={() => setActiveCert(cert)}
                    style={{ 
                      padding: '10px 15px', backgroundColor: activeCert === cert ? THEME_COLORS[cert] : '#222',
                      color: activeCert === cert ? '#fff' : '#aaa', borderRadius: '8px', cursor: 'pointer',
                      fontWeight: activeCert === cert ? 'bold' : 'normal', border: activeCert === cert ? `2px solid ${THEME_COLORS[cert]}` : '2px solid transparent'
                    }}
                  >
                    Step {idx + 1}: {cert}
                  </div>
                  {idx < 3 && <div style={{ color: '#555' }}>➔</div>}
                </React.Fragment>
              ))}
            </div>
          </div>
        );
      }
      case 'quiz': {
        if (!quiz && !generating) {
          setTimeout(() => generateQuiz(activeCert, level), 0);
        }
        return (
          <div style={{ padding: '10px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h2 style={{ color: THEME_COLORS[activeCert], margin: 0 }}>Quiz</h2>
              {quiz && <span style={{ backgroundColor: '#222', padding: '5px 10px', borderRadius: '4px', fontSize: '14px' }}>Lv: {quiz.difficulty} | {quiz.topic}</span>}
            </div>

            {generating ? (
              <div style={{ textAlign: 'center', padding: '40px', color: '#888' }}>
                <div style={{ fontSize: '24px', marginBottom: '10px' }}>Loading...</div>
                <div>AIが難易度 {level} の問題を生成中...</div>
              </div>
            ) : quiz ? (
              <div>
                <div style={{ fontSize: '18px', lineHeight: '1.6', marginBottom: '30px', backgroundColor: '#222', padding: '20px', borderRadius: '8px' }}>
                  {quiz.question}
                </div>
                
                <div style={{ display: 'flex', flexDirection: 'column', gap: '15px', marginBottom: '30px' }}>
                  {quiz.options.map((opt, idx) => {
                    let btnColor = '#333';
                    let borderColor = '#444';
                    if (answered) {
                      if (idx === quiz.correct) {
                        btnColor = 'rgba(48, 209, 88, 0.2)';
                        borderColor = '#30D158';
                      } else if (idx === selected) {
                        btnColor = 'rgba(255, 69, 58, 0.2)';
                        borderColor = '#FF453A';
                      }
                    } else if (selected === idx) {
                      borderColor = THEME_COLORS[activeCert];
                    }

                    return (
                      <button
                        key={idx}
                        onClick={() => submitAnswer(idx)}
                        disabled={answered}
                        style={{
                          textAlign: 'left', padding: '15px 20px', fontSize: '16px', color: '#fff',
                          backgroundColor: btnColor, border: `2px solid ${borderColor}`,
                          borderRadius: '8px', cursor: answered ? 'default' : 'pointer',
                          transition: 'all 0.2s'
                        }}
                      >
                        {opt}
                      </button>
                    )
                  })}
                </div>

                {answered && (
                  <div style={{ animation: 'fadeIn 0.5s', backgroundColor: '#222', padding: '20px', borderRadius: '8px', borderLeft: `4px solid ${selected === quiz.correct ? '#30D158' : '#FF453A'}` }}>
                    <h3 style={{ margin: '0 0 10px 0', color: selected === quiz.correct ? '#30D158' : '#FF453A' }}>
                      {selected === quiz.correct ? '✅ 正解！' : '❌ 不正解...'}
                    </h3>
                    <p style={{ lineHeight: '1.6', margin: '0 0 20px 0' }}>{quiz.explanation}</p>
                    
                    <div style={{ display: 'flex', gap: '15px', flexWrap: 'wrap' }}>
                      <button 
                        onClick={() => generateQuiz(activeCert, level)}
                        style={{ flex: '1 1 auto', padding: '12px', backgroundColor: THEME_COLORS[activeCert], color: '#fff', border: 'none', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer' }}
                      >
                        次の問題へ
                      </button>
                      <button 
                        onClick={() => setView('chat')}
                        style={{ flex: '1 1 auto', padding: '12px', backgroundColor: '#444', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer' }}
                      >
                        AIとディスカッションする →
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : null}
          </div>
        );
      }
      case 'chat':
        return (
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: '60vh' }}>
            <h2 style={{ color: THEME_COLORS[activeCert], marginBottom: '15px', marginTop: '10px' }}>Discussion</h2>
            
            <div style={{ flex: 1, backgroundColor: '#1a1a24', borderRadius: '8px', padding: '15px', overflowY: 'auto', marginBottom: '15px', border: '1px solid #333', maxHeight: '50vh' }}>
              {chatMessages.length === 0 ? (
                <div style={{ textAlign: 'center', color: '#888', marginTop: '40px' }}>
                  <div style={{ marginBottom: '20px' }}>AIアシスタントに質問してみましょう</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', alignItems: 'center' }}>
                    {quiz && <button onClick={() => sendChat('先ほどのクイズの解説をもう少し詳しく教えてください')} style={{ padding: '10px 15px', backgroundColor: '#333', color: '#fff', border: `1px solid ${THEME_COLORS[activeCert]}`, borderRadius: '20px', cursor: 'pointer' }}>先ほどのクイズの解説を詳しく教えて</button>}
                    <button onClick={() => sendChat(`${activeCert}の試験対策として、どのような学習がおすすめですか？`)} style={{ padding: '10px 15px', backgroundColor: '#333', color: '#fff', border: `1px solid ${THEME_COLORS[activeCert]}`, borderRadius: '20px', cursor: 'pointer' }}>おすすめの学習方法は？</button>
                    <button onClick={() => sendChat('わからない用語があるので質問してもいいですか？')} style={{ padding: '10px 15px', backgroundColor: '#333', color: '#fff', border: `1px solid ${THEME_COLORS[activeCert]}`, borderRadius: '20px', cursor: 'pointer' }}>わからない用語を質問する</button>
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                  {chatMessages.map((msg, i) => (
                    <div key={i} style={{ alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '80%', backgroundColor: msg.role === 'user' ? THEME_COLORS[activeCert] : '#333', padding: '12px 16px', borderRadius: '12px', borderBottomRightRadius: msg.role === 'user' ? '2px' : '12px', borderBottomLeftRadius: msg.role === 'user' ? '12px' : '2px', lineHeight: '1.5', overflowX: 'auto' }}>
                      {msg.role === 'user' ? (
                        <div style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</div>
                      ) : (
                        <div className="markdown-body">
                          <ReactMarkdown>{msg.content}</ReactMarkdown>
                        </div>
                      )}
                    </div>
                  ))}
                  {chatLoading && (
                    <div style={{ alignSelf: 'flex-start', backgroundColor: '#333', padding: '12px 16px', borderRadius: '12px', borderBottomLeftRadius: '2px', color: '#aaa', animation: 'pulse 1.5s infinite' }}>
                      ● ● ●
                    </div>
                  )}
                  <div ref={chatBottomRef} />
                </div>
              )}
            </div>

            <div style={{ display: 'flex', gap: '10px' }}>
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && sendChat()}
                placeholder="メッセージを入力... (Enterで送信)"
                style={{ flex: 1, padding: '15px', borderRadius: '8px', border: '1px solid #444', backgroundColor: '#222', color: '#fff', fontSize: '16px' }}
                disabled={chatLoading}
              />
              <button 
                onClick={() => sendChat()}
                disabled={chatLoading || !chatInput.trim()}
                style={{ padding: '0 25px', backgroundColor: chatInput.trim() && !chatLoading ? THEME_COLORS[activeCert] : '#444', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: 'bold', cursor: chatInput.trim() && !chatLoading ? 'pointer' : 'default', transition: 'background-color 0.2s' }}
              >
                送信
              </button>
            </div>
          </div>
        );
      case 'stats': {
        const answers = records?.answers || [];
        // Calculate global stats per cert
        const statsPerCert = Object.keys(THEME_COLORS).map(cert => {
          const certAns = answers.filter(a => a.cert === cert);
          const correct = certAns.filter(a => a.correct).length;
          const total = certAns.length;
          const accuracy = total > 0 ? Math.round((correct / total) * 100) : 0;
          return { cert, total, correct, accuracy, color: THEME_COLORS[cert] };
        });

        const recentHistory = [...answers].sort((a, b) => b.timestamp - a.timestamp).slice(0, 10);

        return (
          <div style={{ padding: '10px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '10px', marginTop: 0 }}>
              <h2 style={{ color: '#fff', margin: 0 }}>総合統計 (Global Stats)</h2>
              <button 
                onClick={exportToMarkdown}
                style={{ padding: '10px 15px', backgroundColor: THEME_COLORS[activeCert], color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', transition: 'opacity 0.2s' }}
                onMouseOver={(e) => e.target.style.opacity = 0.8}
                onMouseOut={(e) => e.target.style.opacity = 1}
              >
                📥 参考書を出力 (Markdown)
              </button>
            </div>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', marginBottom: '40px' }}>
              {statsPerCert.map(stat => (
                <div key={stat.cert} style={{ backgroundColor: '#222', padding: '15px', borderRadius: '8px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
                    <span style={{ fontWeight: 'bold', fontSize: '16px', color: stat.color }}>{stat.cert}</span>
                    <span style={{ color: '#aaa', fontSize: '14px' }}>
                      {stat.total > 0 ? `${stat.correct} / ${stat.total} (${stat.accuracy}%)` : '未受験'}
                    </span>
                  </div>
                  <div style={{ height: '8px', backgroundColor: '#333', borderRadius: '4px', overflow: 'hidden' }}>
                    <div style={{ 
                      height: '100%', 
                      width: `${stat.accuracy}%`, 
                      backgroundColor: stat.color, 
                      transition: 'width 0.5s ease' 
                    }} />
                  </div>
                </div>
              ))}
            </div>

            <h3 style={{ borderBottom: '1px solid #333', paddingBottom: '10px', marginBottom: '20px' }}>直近の解答履歴 (Recent 10)</h3>
            
            {recentHistory.length === 0 ? (
              <div style={{ color: '#888', fontStyle: 'italic', textAlign: 'center', padding: '20px', backgroundColor: '#222', borderRadius: '8px' }}>
                解答履歴がありません。クイズを開始して記録を残しましょう。
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {recentHistory.map((hist, idx) => {
                  const dateInfo = new Date(hist.timestamp);
                  const timeStr = `${dateInfo.getMonth()+1}/${dateInfo.getDate()} ${dateInfo.getHours().toString().padStart(2, '0')}:${dateInfo.getMinutes().toString().padStart(2, '0')}`;
                  return (
                    <div key={idx} style={{ display: 'flex', alignItems: 'center', backgroundColor: '#222', padding: '12px 15px', borderRadius: '8px', borderLeft: `4px solid ${hist.correct ? '#30D158' : '#FF453A'}` }}>
                      <div style={{ fontSize: '20px', marginRight: '15px' }}>{hist.correct ? '✅' : '❌'}</div>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '4px' }}>
                          <span style={{ backgroundColor: THEME_COLORS[hist.cert], color: '#fff', fontSize: '12px', padding: '2px 6px', borderRadius: '4px', fontWeight: 'bold' }}>{hist.cert}</span>
                          <span style={{ fontSize: '14px', fontWeight: 'bold' }}>{hist.topic}</span>
                        </div>
                        <div style={{ color: '#aaa', fontSize: '12px' }}>
                          難易度: Lv.{hist.difficulty} 
                        </div>
                      </div>
                      <div style={{ color: '#888', fontSize: '12px', textAlign: 'right' }}>
                        {timeStr}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      }
      case 'help':
        return (
          <div style={{ padding: '10px' }}>
            <h2 style={{ color: '#fff', marginBottom: '20px', marginTop: 0 }}>利用方法・設定</h2>
            
            <div style={{ backgroundColor: '#222', padding: '20px', borderRadius: '8px', marginBottom: '30px' }}>
              <h3 style={{ color: THEME_COLORS[activeCert], marginTop: 0, borderBottom: '1px solid #444', paddingBottom: '10px' }}>APIキー設定 (Local Development)</h3>
              <p style={{ fontSize: '14px', color: '#ccc', lineHeight: '1.5', marginBottom: '15px' }}>
                ローカル環境でAI機能（問題生成・チャット）をご利用になる場合、Anthropic APIキーが必要です。<br/>
                Artifact環境でご利用の場合は、システムから自動的にキーが注入されるため設定不要です。未設定の場合はモック（ダミーデータ）で動作をテストできます。
              </p>
              <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '10px' }}>
                <input 
                  type="password" 
                  placeholder="API Key (sk-ant-...)" 
                  value={apiKeyInput}
                  onChange={(e) => setApiKeyInput(e.target.value)}
                  style={{ flex: 1, minWidth: '200px', padding: '10px', borderRadius: '4px', border: '1px solid #444', backgroundColor: '#111', color: '#fff', fontFamily: 'monospace' }}
                />
              </div>
              <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                <input 
                  type="text" 
                  placeholder="Model (e.g. claude-3-haiku-20240307)" 
                  value={apiModelInput}
                  onChange={(e) => setApiModelInput(e.target.value)}
                  style={{ flex: 1, minWidth: '200px', padding: '10px', borderRadius: '4px', border: '1px solid #444', backgroundColor: '#111', color: '#fff', fontFamily: 'monospace' }}
                />
                <button 
                  onClick={() => {
                    if (apiKeyInput.trim()) {
                      localStorage.setItem('aws-study-api-key', apiKeyInput.trim());
                      localStorage.setItem('aws-study-api-model', apiModelInput.trim() || 'claude-3-haiku-20240307');
                      alert('APIキーとモデル名をブラウザに保存しました。');
                    } else {
                      localStorage.removeItem('aws-study-api-key');
                      alert('APIキー設定を削除しました。モックデータ動作に戻ります。');
                    }
                  }}
                  style={{ padding: '10px 20px', backgroundColor: THEME_COLORS[activeCert], color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}
                >
                  設定を保存 / キー削除
                </button>
              </div>
            </div>

            <div style={{ backgroundColor: '#222', padding: '20px', borderRadius: '8px' }}>
              <h3 style={{ color: THEME_COLORS[activeCert], marginTop: 0, borderBottom: '1px solid #444', paddingBottom: '10px' }}>アプリの利用方法</h3>
              
              <h4 style={{ color: '#fff', marginBottom: '5px' }}>1. 資格の選択</h4>
              <p style={{ fontSize: '14px', color: '#ccc', lineHeight: '1.5', marginTop: 0, marginBottom: '15px' }}>
                ヘッダーのタブから目標の資格（SAA, CloudOps, Security, SAP）を選びます。アプリのUI色が資格ごとに切り替わります。
              </p>

              <h4 style={{ color: '#fff', marginBottom: '5px' }}>2. クイズの実行 (QUIZ)</h4>
              <p style={{ fontSize: '14px', color: '#ccc', lineHeight: '1.5', marginTop: 0, marginBottom: '15px' }}>
                現在のレベル（Lv1〜5）に応じた適切な難易度の4択問題がAIによって生成されます。解答後、自動的に正誤判定と詳細な解説が表示されます。
              </p>

              <h4 style={{ color: '#fff', marginBottom: '5px' }}>3. AIディスカッション (DISCUSSION)</h4>
              <p style={{ fontSize: '14px', color: '#ccc', lineHeight: '1.5', marginTop: 0, marginBottom: '15px' }}>
                クイズでわからなかった専門用語や、他の選択肢がなぜ間違っているかなど、クイズの文脈を引き継ぎながら専属のAIコーチと対話することができます。
              </p>

              <h4 style={{ color: '#fff', marginBottom: '5px' }}>4. 学習の振り返りとエクスポート (HOME / STATS)</h4>
              <p style={{ fontSize: '14px', color: '#ccc', lineHeight: '1.5', marginTop: 0 }}>
                HOMEでは選択中資格のトピック別正答率やレベルの進行度を、STATSでは全資格の総合的な習熟度グラフと、直近10件の日時入り解答履歴を確認できます。<br/>
                また、STATS画面の「📥 参考書を出力 (Markdown)」ボタンから、これまでの問題・解説・ディスカッション履歴を1つのファイルとしてダウンロード可能です。
              </p>
            </div>
          </div>
        );
      default:
        return <div>View not found</div>;
    }
  };

  // Ensure body has no margin for full screen dark mode
  useEffect(() => {
    document.body.style.margin = "0";
    document.body.style.backgroundColor = "#0a0a0f";
    // Also change the title based on active cert
    document.title = `AWS Study - ${activeCert}`;
  }, [activeCert]);

  return (
    <div style={baseLayoutStyle}>
      <style>{`
        .markdown-body p { margin-top: 0; margin-bottom: 0.8em; }
        .markdown-body p:last-child { margin-bottom: 0; }
        .markdown-body ul, .markdown-body ol { margin-top: 0; margin-bottom: 0.8em; padding-left: 20px; }
        .markdown-body code { background-color: rgba(255,255,255,0.1); padding: 2px 4px; border-radius: 4px; font-family: monospace; }
        .markdown-body pre { background-color: rgba(0,0,0,0.3); padding: 12px; border-radius: 6px; overflow-x: auto; margin-bottom: 0.8em; }
        .markdown-body pre code { background-color: transparent; padding: 0; }
        .markdown-body h1, .markdown-body h2, .markdown-body h3, .markdown-body h4 { margin-top: 1.2em; margin-bottom: 0.5em; }
        .markdown-body blockquote { border-left: 4px solid #555; margin: 0; padding-left: 10px; color: #ccc; }
      `}</style>
      <div style={containerStyle}>
        
        {/* Header (Cert Tabs) */}
        <div style={headerStyle}>
          <div>
            <h1 style={titleStyle}>
              AWS Study
              <span style={{ fontSize: '14px', marginLeft: '10px', color: THEME_COLORS[activeCert], fontWeight: 'normal' }}>
                v1.0
              </span>
            </h1>
            <div style={{ marginTop: '5px', fontSize: '14px', color: THEME_COLORS[activeCert], fontWeight: 'bold' }}>
              {loadingStorage ? 'Loading...' : `Lv. ${level}`}
            </div>
          </div>
          <div style={certTabsStyle}>
            {Object.keys(THEME_COLORS).map(cert => (
              <button 
                key={cert} 
                style={getTabStyle(cert)}
                onClick={() => {
                  setActiveCert(cert);
                  // Optional: switch back to home when changing certs
                  setView('home'); 
                }}
              >
                {cert}
              </button>
            ))}
          </div>
        </div>

        {/* Navigation Bar */}
        <div style={navBarStyle}>
          <div style={getNavStyle('home')} onClick={() => setView('home')}>HOME</div>
          <div style={getNavStyle('quiz')} onClick={() => setView('quiz')}>QUIZ</div>
          <div style={getNavStyle('chat')} onClick={() => setView('chat')}>DISCUSSION</div>
          <div style={getNavStyle('stats')} onClick={() => setView('stats')}>STATS</div>
          <div style={getNavStyle('help')} onClick={() => setView('help')}>HELP / SETTINGS</div>
        </div>

        {/* Dynamic Content Area */}
        <div style={contentAreaStyle}>
          {renderViewContent()}
        </div>

      </div>
    </div>
  );
};

export default App;
