# 🏥 Sistema de Gestão de Clínica

Aplicação web completa para gerenciamento de clínica, com áreas específicas para **Clientes**, **Profissionais** e **Administradores**.  
O sistema foi desenvolvido com **React + TypeScript + Firebase**, focado em simplicidade, organização e fácil manutenção.

---

## ✨ Funcionalidades

### 👤 Área do Cliente

- Cadastro e login de usuário
- Preenchimento e edição de questionário pessoal
- Acesso às informações cadastradas

### 🩺 Área do Profissional

- Visualização da própria agenda de consultas
- Acesso aos dados básicos dos clientes das consultas
- Espaço para observações/prontuários (implementação inicial)

### 👨‍💼 Área do Administrador

- Cadastro de novos usuários (cliente, profissional, admin)
- Gerenciamento de agendamentos da clínica
- Visualização geral do sistema

---

## 🛠️ Tecnologias Utilizadas

![React](https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB)
![Vite](https://img.shields.io/badge/Vite-646CFF?style=for-the-badge&logo=vite&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
![CSS3](https://img.shields.io/badge/CSS3-1572B6?style=for-the-badge&logo=css3&logoColor=white)
![Framer Motion](https://img.shields.io/badge/Framer%20Motion-0055FF?style=for-the-badge&logo=framer&logoColor=white)
![Lucide](https://img.shields.io/badge/Lucide-181717?style=for-the-badge&logo=lucide&logoColor=white)

![Firebase](https://img.shields.io/badge/Firebase-FFCA28?style=for-the-badge&logo=firebase&logoColor=black)
![Firestore](https://img.shields.io/badge/Firestore-FFCA28?style=for-the-badge&logo=firebase&logoColor=black)
![Firebase Hosting](https://img.shields.io/badge/Hosting-FFCA28?style=for-the-badge&logo=firebase&logoColor=black)

---

## 📂 Estrutura do Projeto

- `App.tsx` → controle de navegação por estado (sem react-router)
- `Cadastro.tsx` → registro de usuários com Firebase Auth + Firestore
- `PainelCliente.tsx` → questionário e dados do cliente
- `PainelProfissional.tsx` → agenda de consultas e dados de clientes
- `PainelAdmin.tsx` → gestão de usuários e agendamentos

---

## 🚀 Como rodar o projeto localmente

1. Clone este repositório:
   ```bash
   git clone https://github.com/seu-usuario/seu-repositorio.git
   ```
